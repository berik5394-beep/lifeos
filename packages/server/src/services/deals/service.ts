import type { Deal, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { localDateStr, localDateOnlyUTC, dateOnlyUTC, localMonthOnlyUTC, localMonthStartUTC } from '../../lib/tz.js';
import { getEntityGraph } from '../entity-graph/index.js';
import { defaultNextStep, isOpenStage, OPEN_STAGES, type DealStage } from './stages.js';
import { salesPace, coveringDeals, type Pace } from './pace.js';
import { formatDealsSection, describePlan } from './format.js';

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
): Promise<{ deal: Deal; taggedClient: boolean; step: Step }> {
  const { today: t } = await today(userId, now);
  const personName = input.personName.trim();
  const { entityId, tagged } = await ensureClient(userId, personName);
  const stage: DealStage = input.stage ?? 'new';
  const step: Step = input.nextStepDate
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
  return { deal, taggedClient: tagged, step };
}

/** Открытые сделки клиента (+ уточнение названия). Сущность → по FK, иначе по имени. */
export async function findOpenDeals(userId: string, personName: string, title?: string | null): Promise<Deal[]> {
  const ent = await getEntityGraph().resolveForMerge(userId, personName.trim(), 'person');
  const where: Prisma.DealWhereInput = {
    userId,
    stage: { in: [...OPEN_STAGES] },
    OR: [
      ...(ent ? [{ personEntityId: ent.id }] : []),
      { personName: { equals: personName.trim(), mode: 'insensitive' } },
    ],
    ...(title ? { title: { contains: title.trim(), mode: 'insensitive' } } : {}),
  };
  return prisma.deal.findMany({ where, orderBy: { createdAt: 'desc' } });
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
  if (patch.amount !== undefined && patch.amount !== cur.amount) {
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
  const incomeOffer = stageChanged && deal.stage === 'won' && deal.amount != null && !deal.wonIncomeId;
  return { deal, step, stageChanged, incomeOffer };
}

export type IncomeResult =
  | { ok: true; already: boolean; amount: number }
  | { ok: false; reason: 'not_found' | 'no_amount' | 'not_won' };

/** Доход по выигранной сделке — ровно один раз (wonIncomeId @unique). */
export async function recordDealIncome(userId: string, dealId: string, now: Date = new Date()): Promise<IncomeResult> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, userId } });
  if (!deal) return { ok: false, reason: 'not_found' };
  if (deal.amount == null) return { ok: false, reason: 'no_amount' };
  if (deal.stage !== 'won') return { ok: false, reason: 'not_won' };
  if (deal.wonIncomeId) return { ok: true, already: true, amount: deal.amount };
  const tz = await getUserTimezone(userId);
  const amount = deal.amount;
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

export async function listDeals(userId: string, status: 'open' | 'closed', now: Date = new Date()): Promise<Deal[]> {
  if (status === 'open') {
    return prisma.deal.findMany({ where: { userId, stage: { in: [...OPEN_STAGES] } }, orderBy: [{ nextStepAt: 'asc' }, { createdAt: 'desc' }] });
  }
  const since = new Date(now.getTime() - 90 * 86_400_000);
  return prisma.deal.findMany({ where: { userId, stage: { in: ['won', 'lost'] }, closedAt: { gte: since } }, orderBy: { closedAt: 'desc' } });
}

export async function setSalesPlan(userId: string, amount: number, now: Date = new Date()): Promise<{ monthStart: Date; amount: number }> {
  const tz = await getUserTimezone(userId);
  const monthStart = localMonthOnlyUTC(tz, now);
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

export async function salesPlanStatus(userId: string, now: Date = new Date()): Promise<PlanStatus | null> {
  const tz = await getUserTimezone(userId);
  const monthStart = localMonthOnlyUTC(tz, now);
  const plan = await prisma.salesPlan.findUnique({ where: { userId_monthStart: { userId, monthStart } } });
  if (!plan) return null;
  const monthStartInstant = localMonthStartUTC(tz, now);
  const [wonRows, openRows] = await Promise.all([
    prisma.deal.findMany({ where: { userId, stage: 'won', closedAt: { gte: monthStartInstant } }, select: { amount: true } }),
    prisma.deal.findMany({ where: { userId, stage: { in: [...OPEN_STAGES] } }, select: { personName: true, amount: true } }),
  ]);
  const won = wonRows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const open = openRows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const todayCivil = localDateStr(tz, now);
  const [y, m, d] = todayCivil.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pace = salesPace({ plan: plan.amount, won, open, dayOfMonth: d, daysInMonth });
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
  });
  const plan = await salesPlanStatus(userId, now);
  const step = (d: { nextStepAt: Date | null }) => (d.nextStepAt ? d.nextStepAt.toISOString().slice(0, 10) : null);
  return formatDealsSection({
    openCount: open.length,
    openSum: open.reduce((s, d) => s + (d.amount ?? 0), 0),
    dueToday: open.filter((d) => step(d) === todayCivil).map((d) => d.personName),
    overdue: open.filter((d) => { const s = step(d); return s != null && s < todayCivil; }).map((d) => d.personName),
    plan: plan
      ? describePlan({ plan: plan.plan, won: plan.won, open: plan.open, behind: plan.pace.behind, covering: plan.covering, noAmount: plan.noAmount })
      : null,
  });
}
