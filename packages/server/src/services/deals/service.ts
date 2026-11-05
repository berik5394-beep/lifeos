import type { Deal, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { localDateStr, localDateOnlyUTC, dateOnlyUTC, localMonthOnlyUTC, localMonthStartUTC, localNextMonthStartUTC } from '../../lib/tz.js';
import { getEntityGraph } from '../entity-graph/index.js';
import { defaultNextStep, isOpenStage, OPEN_STAGES, type DealStage } from './stages.js';
import { salesPace, coveringDeals, type Pace } from './pace.js';
import { formatDealsSection, describePlan, describeUpdated, describeWhichDeal, fmtMoneyExact, dealStepLabel, describeSalesVsSavings } from './format.js';
import { gatherReflectorFacts } from '../reflector-service.js';
import { computePortfolioPace } from '../savings-pace.js';
import { withTimeout } from '../../lib/with-timeout.js';
import { isV2DealsEnabled } from '../../lib/feature-flags.js';
import type { CapacityItem } from '../capacity-fit.js';

export const DEAL_INCOME_ACTION = 'record_deal_income';

export interface CreateDealInput {
  personName: string;
  title?: string | null;
  amount?: number | null;
  stage?: DealStage;
  nextStepDate?: string | null; // YYYY-MM-DD
  nextStepText?: string | null;
  note?: string | null;
}
export interface UpdateDealPatch {
  stage?: DealStage;
  amount?: number | null;
  nextStepDate?: string | null;
  nextStepText?: string | null;
  note?: string | null;
  lostReason?: string | null;
}
type Step = { date: string; text: string } | null;

const civil = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function today(userId: string, now: Date): Promise<{ tz: string; today: string }> {
  const tz = await getUserTimezone(userId);
  return { tz, today: localDateStr(tz, now) };
}

/** Клиент: найти человека (точный тир) или завести; без типа — отметить клиентом. */
async function ensureClient(userId: string, personName: string): Promise<{ entityId: string; tagged: boolean }> {
  const graph = getEntityGraph();
  const found = await graph.resolveForMerge(userId, personName, 'person');
  const attrs = (found?.attributes ?? {}) as Record<string, unknown>;
  if (found && typeof attrs.personType === 'string') return { entityId: found.id, tagged: false };
  const ent = await graph.upsertEntity(
    userId,
    { type: 'person', name: found?.name ?? personName, attributes: { personType: 'client' } as Prisma.JsonObject, importance: 5 },
    { deliberate: true },
  );
  return { entityId: ent.id, tagged: true };
}

export async function createDeal(
  userId: string,
  input: CreateDealInput,
  now: Date = new Date(),
): Promise<{ deal: Deal; taggedClient: boolean; step: Step; incomeOffer: boolean }> {
  const { today: t } = await today(userId, now);
  const personName = input.personName.trim();
  const { entityId, tagged } = await ensureClient(userId, personName);
  const stage: DealStage = input.stage ?? 'new';
  // Закрытая стадия — следующего шага нет, даже если его назвали.
  const step: Step = !isOpenStage(stage)
    ? null
    : input.nextStepDate
      ? { date: input.nextStepDate, text: input.nextStepText?.trim() || 'следующий шаг' }
      : defaultNextStep(stage, t);
  const deal = await prisma.deal.create({
    data: {
      userId,
      personEntityId: entityId,
      personName,
      title: input.title?.trim() || 'сделка',
      amount: input.amount ?? null,
      stage,
      nextStepAt: step ? dateOnlyUTC(step.date) : null,
      nextStepText: step?.text ?? null,
      closedAt: isOpenStage(stage) ? null : now,
      events: {
        create: [
          { kind: 'created', to: stage, text: input.note ?? null },
        ],
      },
    },
  });
  return { deal, taggedClient: tagged, step, incomeOffer: stage === 'won' && deal.amount != null };
}

const norm = (t: string): string => t.trim().toLowerCase().replace(/ё/g, 'е');
const stems = (t: string): Set<string> =>
  new Set(norm(t).split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));

/** Похоже ли название сделки на сказанное: вхождение в любую сторону или общий корень ≥5 букв. */
export function titleMatches(dealTitle: string, said: string): boolean {
  const a = norm(dealTitle), b = norm(said);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const sa = stems(a);
  for (const st of stems(b)) if (sa.has(st)) return true;
  return false;
}

/**
 * Открытые сделки клиента. Сущность → по FK, иначе по имени. Ревью I6: название —
 * НЕ фильтр (неточное «оборудования» прятало единственную сделку → «нет сделки» →
 * дубль), а только развязка при >1; развязка дала 0 → все (переспросим списком).
 */
async function clientWhere(userId: string, personName: string): Promise<Prisma.DealWhereInput> {
  const ent = await getEntityGraph().resolveForMerge(userId, personName.trim(), 'person');
  return {
    userId,
    OR: [
      ...(ent ? [{ personEntityId: ent.id }] : []),
      { personName: { equals: personName.trim(), mode: 'insensitive' } },
    ],
  };
}

function tieBreak(all: Deal[], title?: string | null): Deal[] {
  if (all.length <= 1 || !title?.trim()) return all;
  const narrowed = all.filter((d) => titleMatches(d.title, title));
  return narrowed.length ? narrowed : all;
}

export async function findOpenDeals(userId: string, personName: string, title?: string | null): Promise<Deal[]> {
  const where: Prisma.DealWhereInput = { ...(await clientWhere(userId, personName)), stage: { in: [...OPEN_STAGES] } };
  return tieBreak(await prisma.deal.findMany({ where, orderBy: { createdAt: 'desc' } }), title);
}

/** Ревью I3: закрытые (won/lost) сделки клиента за 30 дней — чтобы досказать сумму или вернуть в работу. */
export async function findRecentClosedDeals(
  userId: string,
  personName: string,
  title?: string | null,
  now: Date = new Date(),
): Promise<Deal[]> {
  const where: Prisma.DealWhereInput = {
    ...(await clientWhere(userId, personName)),
    stage: { in: ['won', 'lost'] },
    closedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
  };
  return tieBreak(await prisma.deal.findMany({ where, orderBy: { closedAt: 'desc' } }), title);
}

export async function updateDeal(
  userId: string,
  dealId: string,
  patch: UpdateDealPatch,
  now: Date = new Date(),
): Promise<{ deal: Deal; step: Step; stageChanged: boolean; incomeOffer: boolean }> {
  const { today: t } = await today(userId, now);
  const cur = await prisma.deal.findFirst({ where: { id: dealId, userId } });
  if (!cur) throw new Error('not_found');

  const data: Prisma.DealUpdateInput = { lastActivityAt: now };
  const events: Prisma.DealEventCreateWithoutDealInput[] = [];
  let step: Step = null;
  const stageChanged = !!patch.stage && patch.stage !== cur.stage;

  if (stageChanged && patch.stage) {
    data.stage = patch.stage;
    data.stageChangedAt = now;
    events.push({ kind: 'stage', from: cur.stage, to: patch.stage });
    if (isOpenStage(patch.stage)) {
      data.closedAt = null;
      step = defaultNextStep(patch.stage, t);
    } else {
      data.closedAt = now;
      data.nextStepAt = null;
      data.nextStepText = null;
    }
  }
  const amountChanged = patch.amount !== undefined && patch.amount !== cur.amount;
  if (amountChanged) {
    data.amount = patch.amount;
    events.push({ kind: 'amount', from: cur.amount != null ? String(cur.amount) : null, to: patch.amount != null ? String(patch.amount) : null });
  }
  const finalStage = (patch.stage ?? cur.stage) as DealStage;
  if (patch.nextStepDate && isOpenStage(finalStage)) {
    step = { date: patch.nextStepDate, text: patch.nextStepText?.trim() || cur.nextStepText || 'следующий шаг' };
  }
  if (step) {
    data.nextStepAt = dateOnlyUTC(step.date);
    data.nextStepText = step.text;
    events.push({ kind: 'next_step', from: civil(cur.nextStepAt), to: step.date, text: step.text });
  }
  if (patch.note) events.push({ kind: 'note', text: patch.note.trim() });
  if (patch.lostReason) data.lostReason = patch.lostReason.trim();
  if (events.length) data.events = { create: events };

  const deal = await prisma.deal.update({ where: { id: cur.id }, data });
  if (deal.personEntityId) {
    await prisma.entity.update({ where: { id: deal.personEntityId }, data: { lastSeenAt: now } }).catch(() => {});
  }
  // Ревью I3: «выиграна» без суммы → назвали сумму позже → тоже предлагаем доход.
  const incomeOffer = deal.stage === 'won' && deal.amount != null && !deal.wonIncomeId && (stageChanged || amountChanged);
  return { deal, step, stageChanged, incomeOffer };
}

export type IncomeResult =
  | { ok: true; already: boolean; amount: number }
  | { ok: false; reason: 'not_found' | 'no_amount' | 'not_won' }
  | { ok: false; reason: 'possible_duplicate'; amount: number; personName: string; existingDate: string };

/** «Ахмет»→«ахмет», «Дана»→«дан»: основа имени для поиска в свободном тексте источника дохода. */
function nameStem(name: string): string {
  const n = name.trim().toLowerCase();
  return n.length > 3 ? n.replace(/[аяеиоуыьй]$/, '') : n;
}

/**
 * Доход по выигранной сделке — ровно один раз (wonIncomeId @unique).
 * Страховка (ревью B2): если за 30 дней уже есть доход той же суммы с именем клиента
 * в источнике (записан руками/голым add_income) — молча не пишем, а переспрашиваем;
 * force — юзер подтвердил «записать ещё раз».
 */
export async function recordDealIncome(
  userId: string,
  dealId: string,
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<IncomeResult> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, userId } });
  if (!deal) return { ok: false, reason: 'not_found' };
  if (deal.amount == null) return { ok: false, reason: 'no_amount' };
  if (deal.stage !== 'won') return { ok: false, reason: 'not_won' };
  if (deal.wonIncomeId) return { ok: true, already: true, amount: deal.amount };
  const tz = await getUserTimezone(userId);
  const amount = deal.amount;
  if (!opts.force) {
    const dup = await prisma.income.findFirst({
      where: {
        userId,
        amount,
        source: { contains: nameStem(deal.personName), mode: 'insensitive' },
        createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (dup) {
      return { ok: false, reason: 'possible_duplicate', amount, personName: deal.personName, existingDate: civil(dup.date) ?? localDateStr(tz, now) };
    }
  }
  try {
    await prisma.$transaction(async (tx) => {
      const inc = await tx.income.create({
        data: { userId, date: localDateOnlyUTC(tz, now), source: `Сделка: ${deal.personName} — ${deal.title}`, amount },
      });
      const upd = await tx.deal.updateMany({ where: { id: deal.id, wonIncomeId: null }, data: { wonIncomeId: inc.id } });
      if (upd.count === 0) throw new Error('already');
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'already') return { ok: true, already: true, amount };
    throw err;
  }
  return { ok: true, already: false, amount };
}

/** «Ахмета за оборудование» → варианты имени: «Ахмета», «Ахмет» (род. → им.: -а, -ы→-а, -и→-я/-а, -я→-й/-ь). */
function mentionCandidates(mention: string): string[] {
  const w = mention.trim().replace(/^от\s+/i, '').split(/[\s,.;:!?—-]+/)[0] ?? '';
  if (w.length < 2) return [];
  const out = [w];
  if (/[бвгджзклмнпрстфхцчшщ]а$/i.test(w)) out.push(w.slice(0, -1));
  if (/ы$/i.test(w)) out.push(w.slice(0, -1) + 'а');
  if (/и$/i.test(w)) out.push(w.slice(0, -1) + 'я', w.slice(0, -1) + 'а');
  if (/я$/i.test(w)) out.push(w.slice(0, -1) + 'й', w.slice(0, -1) + 'ь');
  return out;
}

export type IncomeRouting =
  | { kind: 'none' }
  | { kind: 'ask'; message: string }
  | { kind: 'won'; message: string; dealId: string };

/**
 * Ревью B2: «получил 2 млн от Ахмета» при ОДНОЙ открытой сделке с Ахметом — это оплата
 * сделки: ставим «выиграна» (сумму берём из сообщения, если у сделки её нет) и предлагаем
 * доход через сделку (одно подтверждение, без второго Income). Несколько сделок или другая
 * сумма — переспрос, ничего не ставим. Нет сделки — none (обычный add_income).
 */
export async function routeIncomeToDeal(
  userId: string,
  amount: number,
  source: string,
  now: Date = new Date(),
): Promise<IncomeRouting> {
  const seen = new Map<string, Deal>();
  for (const c of mentionCandidates(source)) {
    for (const d of await findOpenDeals(userId, c)) seen.set(d.id, d);
    if (seen.size) break;
  }
  const deals = [...seen.values()];
  if (deals.length === 0) return { kind: 'none' };
  const name = deals[0].personName;
  if (deals.length > 1) return { kind: 'ask', message: describeWhichDeal(name, deals, 'Какая оплачена?') };
  const deal = deals[0];
  if (deal.amount != null && deal.amount !== amount) {
    return {
      kind: 'ask',
      message: `Сделка ${name} — ${deal.title} на ${fmtMoneyExact(deal.amount)}, а пришло ${fmtMoneyExact(amount)}. Это полная оплата по сделке? Скажи «${name} оплатил, сумма ${fmtMoneyExact(amount)}» — закрою.`,
    };
  }
  const r = await updateDeal(userId, deal.id, { stage: 'won', ...(deal.amount == null ? { amount } : {}) }, now);
  const { today: t } = await today(userId, now);
  return { kind: 'won', message: describeUpdated(r.deal, r, t), dealId: deal.id };
}

export async function listDeals(userId: string, status: 'open' | 'closed', now: Date = new Date()): Promise<Deal[]> {
  if (status === 'open') {
    return prisma.deal.findMany({ where: { userId, stage: { in: [...OPEN_STAGES] } }, orderBy: [{ nextStepAt: 'asc' }, { createdAt: 'desc' }] });
  }
  const since = new Date(now.getTime() - 90 * 86_400_000);
  return prisma.deal.findMany({ where: { userId, stage: { in: ['won', 'lost'] }, closedAt: { gte: since } }, orderBy: { closedAt: 'desc' } });
}

/** «YYYY-MM» → якорь-инстант внутри месяца (15-е, полдень UTC — тот же месяц в любом поясе). */
function monthAnchor(month: string | undefined, now: Date): Date {
  return month ? new Date(`${month}-15T12:00:00Z`) : now;
}

/** План продаж на месяц (по умолчанию — текущий месяц юзера; month — «YYYY-MM»). */
export async function setSalesPlan(
  userId: string,
  amount: number,
  now: Date = new Date(),
  month?: string,
): Promise<{ monthStart: Date; amount: number }> {
  const tz = await getUserTimezone(userId);
  const monthStart = localMonthOnlyUTC(tz, monthAnchor(month, now));
  await prisma.salesPlan.upsert({
    where: { userId_monthStart: { userId, monthStart } },
    create: { userId, monthStart, amount },
    update: { amount },
  });
  return { monthStart, amount };
}

export interface PlanStatus {
  plan: number;
  won: number;
  open: number;
  noAmount: number;
  pace: Pace;
  covering: string[];
}

export async function salesPlanStatus(userId: string, now: Date = new Date(), month?: string): Promise<PlanStatus | null> {
  const tz = await getUserTimezone(userId);
  const anchor = monthAnchor(month, now);
  const monthStart = localMonthOnlyUTC(tz, anchor);
  const plan = await prisma.salesPlan.findUnique({ where: { userId_monthStart: { userId, monthStart } } });
  if (!plan) return null;
  const monthStartInstant = localMonthStartUTC(tz, anchor);
  const nextMonthInstant = localNextMonthStartUTC(tz, anchor);
  const [wonRows, openRows] = await Promise.all([
    prisma.deal.findMany({
      where: { userId, stage: 'won', closedAt: { gte: monthStartInstant, lt: nextMonthInstant } },
      select: { amount: true },
    }),
    prisma.deal.findMany({ where: { userId, stage: { in: [...OPEN_STAGES] } }, select: { personName: true, amount: true } }),
  ]);
  const won = wonRows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const open = openRows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const todayCivil = localDateStr(tz, now);
  const planMonth = monthStart.toISOString().slice(0, 7);
  const [y, m] = planMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Темп: текущий месяц — по сегодняшнему дню; прошедший — весь; будущий — ещё не начался.
  const cur = todayCivil.slice(0, 7);
  const dayOfMonth = planMonth === cur ? Number(todayCivil.slice(8, 10)) : planMonth < cur ? daysInMonth : 0;
  const pace = salesPace({ plan: plan.amount, won, open, dayOfMonth, daysInMonth });
  return {
    plan: plan.amount,
    won,
    open,
    noAmount: openRows.filter((r) => r.amount == null).length,
    pace,
    covering: coveringDeals(openRows, pace.gap).map((r) => r.personName),
  };
}

/** Блок «Сделки» для контекста робота. READ-ONLY, только факты из БД. */
export async function gatherDealsSection(userId: string, now: Date = new Date()): Promise<string | null> {
  const tz = await getUserTimezone(userId);
  const todayCivil = localDateStr(tz, now);
  const open = await prisma.deal.findMany({
    where: { userId, stage: { in: [...OPEN_STAGES] } },
    select: { personName: true, amount: true, nextStepAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const plan = await salesPlanStatus(userId, now);
  // Факты рефлектора тяжёлые — только если план продаж есть; свой потолок,
  // чтобы медленная строка цели не уронила весь блок по таймауту enrichment.
  const savings = plan ? await withTimeout(salesVsSavingsLine(userId, plan.plan, now), SAVINGS_LINE_BUDGET_MS, null) : null;
  const step = (d: { nextStepAt: Date | null }) => (d.nextStepAt ? d.nextStepAt.toISOString().slice(0, 10) : null);
  return formatDealsSection({
    openCount: open.length,
    openSum: open.reduce((s, d) => s + (d.amount ?? 0), 0),
    clients: open.map((d) => d.personName),
    dueToday: open.filter((d) => step(d) === todayCivil).map((d) => d.personName),
    overdue: open.filter((d) => { const s = step(d); return s != null && s < todayCivil; }).map((d) => d.personName),
    plan: plan
      ? describePlan({ plan: plan.plan, won: plan.won, open: plan.open, behind: plan.pace.behind, covering: plan.covering, noAmount: plan.noAmount })
      : null,
    savings,
  });
}

const SAVINGS_LINE_BUDGET_MS = 700;

/**
 * План продаж ↔ денежная цель: сколько нужно откладывать к главной фин-цели
 * (тот же requiredAnchor, что у коуча накоплений). Нет фин-цели с числом /
 * всё накоплено / сбой → null (строку опускаем).
 */
async function salesVsSavingsLine(userId: string, planAmount: number, now: Date): Promise<string | null> {
  try {
    const facts = await gatherReflectorFacts(userId, now);
    if (facts.financeGoals.length === 0) return null;
    const pf = computePortfolioPace({ goals: facts.financeGoals, capacity: facts.monthlyIncome - facts.monthlyBurn, now });
    if (!pf.anchor || pf.requiredAnchor <= 0) return null;
    return describeSalesVsSavings({ plan: planAmount, goalText: pf.anchor.goal.text, requiredMonthly: pf.requiredAnchor });
  } catch (err) {
    console.warn('[deals] sales↔savings line skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Шаг по сделке ест время дня: звонок/письмо/встреча клиенту. */
export const DEFAULT_DEAL_STEP_MINUTES = 20;
/** Обещание клиенту — как high-задача: не вылетает из fit, не двигается. */
export const DEAL_STEP_IMPORTANCE = 3;

export interface DealStep {
  id: string;
  personName: string;
  title: string;
  nextStepText: string | null;
  /** Гражданская дата шага 'YYYY-MM-DD'. */
  date: string;
}

/**
 * Открытые сделки с шагом в [from, toExcl) (@db.Date, UTC-полночь гражданских
 * дат). Флаг выкл. → [] без запроса (всё, что на этом строится, — как раньше).
 */
export async function listDealSteps(userId: string, from: Date, toExcl: Date): Promise<DealStep[]> {
  if (!isV2DealsEnabled(userId)) return [];
  const rows = await prisma.deal.findMany({
    where: { userId, stage: { in: [...OPEN_STAGES] }, nextStepAt: { gte: from, lt: toExcl } },
    select: { id: true, personName: true, title: true, nextStepText: true, nextStepAt: true },
    orderBy: [{ nextStepAt: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    personName: r.personName,
    title: r.title,
    nextStepText: r.nextStepText,
    date: civil(r.nextStepAt) ?? '',
  }));
}

/** Шаги по сделкам как спрос на время (день/неделя/месяц). Флаг выкл. → []. */
export async function dealStepLoadItems(userId: string, from: Date, toExcl: Date): Promise<CapacityItem[]> {
  const steps = await listDealSteps(userId, from, toExcl);
  return steps.map((s) => ({ label: dealStepLabel(s), demand: DEFAULT_DEAL_STEP_MINUTES, importance: DEAL_STEP_IMPORTANCE }));
}

