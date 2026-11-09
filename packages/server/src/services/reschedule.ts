import { prisma } from '../lib/prisma.js';
import { getUserTimezone } from '../lib/user-context.js';
import { addCivilDays, dateOnlyUTC, localDateStr, localMonthOnlyUTC, localTimeStr, localWeekStartUTC } from '../lib/tz.js';
import { isV2RescheduleEnabled } from '../lib/feature-flags.js';
import { availableMinutesToday } from '../tools/_slots.js';
import { computeCapacityFit } from './capacity-fit.js';
import { DEFAULT_TASK_MINUTES, mapPriority } from './day-load.js';
import { gatherWeekLoad } from './week-load.js';
import { MIN_HORIZON_CAPACITY, MIN_OVERLOAD_DEMAND } from './capacity-fit.js';
export { MIN_HORIZON_CAPACITY, MIN_OVERLOAD_DEMAND };
import { gatherMonthLoad } from './month-load.js';
import { planVsFact } from './plan-vs-fact.js';
import { peekPendingAction, setPendingAction } from './pending-actions.js';
import { captureActivity } from './tool-activity-summary.js';
import { ruDayName } from './goal-slot.js';
import { listDealSteps, DEFAULT_DEAL_STEP_MINUTES, DEAL_STEP_IMPORTANCE } from './deals/service.js';
import { dealStepLabel } from './deals/format.js';

/**
 * Перегруз дня → робот ПРЕДЛАГАЕТ сдвинуть график, юзер подтверждает одним
 * касанием (спека docs/superpowers/specs/2026-11-05-day-overload-reschedule-design.md).
 *
 * Один движок на все входы (create_task, POST /tasks, PUT /tasks со сменой даты):
 * задача уже создана, здесь только расчёт + предложение в PendingAction
 * ('apply_reschedule'). Ничего не двигается без «Подтвердить». Предупреждения
 * о целях — только из реальных связей/чисел БД (антифаб).
 */

export const RESCHEDULE_ACTION = 'apply_reschedule';
export const LOOKAHEAD_DAYS = 7;
export const SHOWN_MOVES = 5;

// ---------------------------------------------------------------------------
// Чистое ядро
// ---------------------------------------------------------------------------

export interface ShiftTask {
  id: string;
  title: string;
  demand: number; // минуты
  importance: number; // больше = важнее
  priority: string;
  time: string | null;
  /** Подзадача — едет вместе с родителем, отдельно не двигаем. */
  fixed?: boolean;
}

export interface ShiftDay {
  date: string; // 'YYYY-MM-DD'
  capacity: number; // свободные минуты
  tasks: ShiftTask[];
}

export interface ShiftMove {
  taskId: string;
  title: string;
  fromDate: string;
  toDate: string;
}

export interface ShiftPlan {
  overloaded: boolean;
  demand: number;
  capacity: number;
  moves: ShiftMove[];
  /** Сдвигаемые, которым за LOOKAHEAD_DAYS места не нашлось. */
  stuck: Array<{ taskId: string; title: string }>;
  /** Нагрузка дня ПОСЛЕ предложенных переносов (> capacity — всё равно не влезет). */
  after: number;
}

const load = (d: ShiftDay) => d.tasks.reduce((s, t) => s + t.demand, 0);

/** Двигать можно: не новую, без времени (договорённость), не critical. */
export function isMovable(t: ShiftTask, keepId: string | null): boolean {
  return t.id !== keepId && !t.time && t.priority !== 'critical' && !t.fixed;
}

/**
 * Что сдвинуть, чтобы день D влез. Наименее важные первыми (при равной
 * важности — крупные: меньше переносов). Каждую — на ближайший день из
 * `ahead`, куда она влезает ЦЕЛИКОМ с учётом уже сдвинутых туда (каскад не
 * перегружает следующий день). Чистая.
 */
export function planShift(day: ShiftDay, ahead: ShiftDay[], keepId: string | null): ShiftPlan {
  const demand = load(day);
  const base = { demand, capacity: day.capacity };
  if (demand <= day.capacity) return { ...base, overloaded: false, moves: [], stuck: [], after: demand };

  const used = new Map(ahead.map((d) => [d.date, load(d)]));
  const candidates = day.tasks
    .filter((t) => isMovable(t, keepId))
    .sort((a, b) => a.importance - b.importance || b.demand - a.demand);

  const moves: ShiftMove[] = [];
  const stuck: ShiftPlan['stuck'] = [];
  let left = demand;
  for (const t of candidates) {
    // Не больше SHOWN_MOVES: каждый перенос юзер видит до «Подтвердить».
    if (left <= day.capacity || moves.length >= SHOWN_MOVES) break;
    const target = ahead.find((d) => (used.get(d.date) ?? 0) + t.demand <= d.capacity);
    if (!target) {
      stuck.push({ taskId: t.id, title: t.title });
      continue;
    }
    used.set(target.date, (used.get(target.date) ?? 0) + t.demand);
    moves.push({ taskId: t.id, title: t.title, fromDate: day.date, toDate: target.date });
    left -= t.demand;
  }
  return { ...base, overloaded: true, moves, stuck, after: left };
}

/** Минуты по-человечески: «40 мин», «1,5 ч», «7 ч». */
export function fmtMinutes(m: number): string {
  if (m < 60) return `${Math.max(0, Math.round(m))} мин`;
  const h = Math.round(m / 30) / 2;
  return `${String(h).replace('.', ',')} ч`;
}

/** «сегодня» / «завтра» / «в четверг (13.11)» — для заголовка. */
export function dayPhrase(date: string, today: string): string {
  if (date === today) return 'сегодня';
  if (date === addCivilDays(today, 1)) return 'завтра';
  return `в ${ruDayName(date)} (${date.slice(8, 10)}.${date.slice(5, 7)})`;
}

/** «на завтра» / «на пятницу (14.11)» — куда переезжает задача. */
export function targetPhrase(date: string, today: string): string {
  if (date === addCivilDays(today, 1)) return 'на завтра';
  return `на ${ruDayName(date)} (${date.slice(8, 10)}.${date.slice(5, 7)})`;
}

// --- цели ---

export interface WeeklyGoalRef {
  id: string;
  goalText: string;
  weekStart: string; // 'YYYY-MM-DD' (понедельник)
  yearlyId: string | null;
}
export interface YearlyGoalRef {
  id: string;
  goalText: string;
  behind: boolean; // отстаёт по plan-vs-fact (не tooEarly)
}
export interface MoveParent {
  taskId: string;
  planParentId: string | null;
  planParentType: string | null;
}

/**
 * Строки «цели меняются» по РЕАЛЬНЫМ связям задача→цель недели→цель года.
 * Без связи — без строки (антифаб). Не больше 3. Чистая.
 */
export function goalWarnings(
  moves: ShiftMove[],
  parents: MoveParent[],
  weekly: Map<string, WeeklyGoalRef>,
  yearly: Map<string, YearlyGoalRef>,
): string[] {
  const out: string[] = [];
  const byTask = new Map(parents.map((p) => [p.taskId, p]));
  for (const mv of moves) {
    const p = byTask.get(mv.taskId);
    if (!p?.planParentId) continue;
    if (p.planParentType === 'WeeklyGoal') {
      const w = weekly.get(p.planParentId);
      if (!w) continue;
      const weekEnd = addCivilDays(w.weekStart, 6);
      if (mv.toDate <= weekEnd || mv.fromDate > weekEnd) continue; // осталась в неделе / уже была за ней
      const y = w.yearlyId ? yearly.get(w.yearlyId) : undefined;
      let line = `⚠️ «${mv.title}» — шаг к цели недели «${w.goalText}» — уходит на следующую неделю: цель недели не закроется вовремя.`;
      if (y) {
        line += y.behind
          ? ` Цель года «${y.goalText}» и так отстаёт — отстанет ещё сильнее.`
          : ` Это тормозит цель года «${y.goalText}».`;
      }
      out.push(line);
    } else if (p.planParentType === 'YearlyGoal') {
      const y = yearly.get(p.planParentId);
      if (!y) continue;
      const days = Math.round((dateOnlyUTC(mv.toDate).getTime() - dateOnlyUTC(mv.fromDate).getTime()) / 86_400_000);
      out.push(
        `⚠️ «${mv.title}» — шаг к цели года «${y.goalText}» — сдвигается на ${days} дн.` +
          (y.behind ? ' Цель и так отстаёт от графика.' : ''),
      );
    }
  }
  return [...new Set(out)].slice(0, 3);
}

export interface HorizonLoad {
  demand: number;
  capacity: number;
  goals: string[]; // открытые цели этого горизонта (тексты)
}

/** «Неделя/месяц перегружены → цели под угрозой». null если влезает. Чистая. */
export function horizonWarning(kind: 'week' | 'month', h: HorizonLoad | null): string | null {
  if (!h || h.demand <= h.capacity) return null;
  // Мало дел или период почти кончился (вечер воскресенья: «свободно ~0» на
  // всю неделю) — предупреждать не о чем, дела переедут сами.
  if (h.demand <= MIN_OVERLOAD_DEMAND || h.capacity < MIN_HORIZON_CAPACITY) return null;
  const name = kind === 'week' ? 'Неделя перегружена' : 'Месяц перегружен';
  const nums = `дел на ~${fmtMinutes(h.demand)}, свободно ~${fmtMinutes(h.capacity)}`;
  if (h.goals.length === 0) return `⚠️ ${name}: ${nums}.`;
  const list = h.goals.slice(0, 3).map((g) => `«${g}»`).join(', ');
  const more = h.goals.length > 3 ? ` и ещё ${h.goals.length - 3}` : '';
  const who = kind === 'week' ? 'цели недели' : 'цели месяца';
  return `⚠️ ${name} (${nums}) — ${who} под угрозой: ${list}${more}.`;
}

/** Текст предложения в облачко робота. Чистая. */
export function describeProposal(args: {
  plan: ShiftPlan;
  day: string;
  today: string;
  warnings: string[];
  /** Сколько шагов по сделкам в этом дне (они в нагрузке, но не двигаются). */
  dealSteps?: number;
}): string {
  const { plan, day, today, warnings, dealSteps = 0 } = args;
  const head = dayPhrase(day, today);
  const lines = [
    `${head[0].toUpperCase()}${head.slice(1)} день перегружен: дел на ~${fmtMinutes(plan.demand)}, ` +
      `свободно ~${fmtMinutes(plan.capacity)}.`,
  ];
  if (plan.moves.length > 0) {
    lines.push('Предлагаю сдвинуть:');
    for (const m of plan.moves) lines.push(`• «${m.title}» → ${targetPhrase(m.toDate, today)}`);
    if (plan.after > plan.capacity) {
      lines.push(`Даже после этого останется ~${fmtMinutes(plan.after)} дел на ~${fmtMinutes(plan.capacity)} — что-то ещё отменить или отдать кому-то?`);
    }
  }
  if (plan.stuck.length > 0) {
    const names = plan.stuck.slice(0, 2).map((s) => `«${s.title}»`).join(', ');
    const more = plan.stuck.length > 2 ? ` и ещё ${plan.stuck.length - 2}` : '';
    lines.push(`Неделя забита — для ${names}${more} места нет. Что-то из этого отменить?`);
  } else if (plan.moves.length === 0) {
    lines.push('Сдвигать нечего: остальное — со временем или критичное. Что-то отменить?');
  }
  if (dealSteps > 0) lines.push(`Звонки/шаги по сделкам (${dealSteps}) не двигаю — это обещания клиентам.`);
  lines.push(...warnings);
  if (plan.moves.length > 0) lines.push('Подтвердить перенос?');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// БД
// ---------------------------------------------------------------------------

const civil = (d: Date) => d.toISOString().slice(0, 10); // @db.Date → 'YYYY-MM-DD'
/** id шага по сделке в окне переносов — не задача, никогда не двигается. */
const DEAL_STEP_ID_PREFIX = 'deal:';

/** День D + следующие LOOKAHEAD_DAYS дней: ёмкость и задачи. */
async function gatherWindow(userId: string, day: string, today: string, nowHHMM: string) {
  const from = dateOnlyUTC(day);
  const toExcl = dateOnlyUTC(addCivilDays(day, LOOKAHEAD_DAYS + 1));
  const [tasks, events, dealSteps] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: { gte: from, lt: toExcl }, completed: false, cancelled: false },
      select: {
        id: true,
        title: true,
        date: true,
        time: true,
        priority: true,
        importance: true,
        estimatedMinutes: true,
        planParentId: true,
        planParentType: true,
        parentId: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: from, lt: toExcl } },
      select: { date: true, startTime: true, endTime: true },
    }),
    // Шаги по сделкам — нагрузка дня, но не двигаем (v1): fixed. Флаг выкл. → [].
    listDealSteps(userId, from, toExcl),
  ]);
  const days: ShiftDay[] = [];
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const date = addCivilDays(day, i);
    const evs = events.filter((e) => civil(e.date) === date);
    days.push({
      date,
      capacity: availableMinutesToday(evs, date === today ? nowHHMM : '00:00'),
      tasks: tasks
        .filter((t) => civil(t.date) === date)
        .map((t) => ({
          id: t.id,
          title: t.title,
          demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
          importance: t.importance ?? mapPriority(t.priority),
          priority: t.priority,
          time: t.time,
          fixed: t.parentId !== null,
        }))
        .concat(
          dealSteps
            .filter((st) => st.date === date)
            .map((st) => ({
              id: `${DEAL_STEP_ID_PREFIX}${st.id}`,
              title: dealStepLabel(st),
              demand: DEFAULT_DEAL_STEP_MINUTES,
              importance: DEAL_STEP_IMPORTANCE,
              priority: 'high',
              time: null,
              fixed: true,
            })),
        ),
    });
  }
  return { days, tasks };
}

async function loadGoalRefs(userId: string, parents: MoveParent[], now: Date) {
  const weeklyIds = parents.filter((p) => p.planParentType === 'WeeklyGoal' && p.planParentId).map((p) => p.planParentId as string);
  const weeklyRows = weeklyIds.length
    ? await prisma.weeklyGoal.findMany({
        where: { id: { in: weeklyIds }, userId, completed: false, archivedAt: null },
        select: { id: true, goalText: true, weekStart: true, planParentId: true, planParentType: true },
      })
    : [];
  const weekly = new Map<string, WeeklyGoalRef>(
    weeklyRows.map((w) => [
      w.id,
      {
        id: w.id,
        goalText: w.goalText,
        weekStart: civil(w.weekStart),
        yearlyId: w.planParentType === 'YearlyGoal' ? w.planParentId : null,
      },
    ]),
  );
  const yearlyIds = [
    ...parents.filter((p) => p.planParentType === 'YearlyGoal' && p.planParentId).map((p) => p.planParentId as string),
    ...[...weekly.values()].map((w) => w.yearlyId).filter((x): x is string => !!x),
  ];
  const yearlyRows = yearlyIds.length
    ? await prisma.yearlyGoal.findMany({
        where: { id: { in: [...new Set(yearlyIds)] }, userId },
        select: { id: true, goalText: true, progress: true, updatedAt: true, area: true },
      })
    : [];
  const verdicts = planVsFact(
    yearlyRows.map((y) => ({ area: y.area, goalText: y.goalText, progress: y.progress, updatedAt: y.updatedAt, planBuiltAt: null, planWeeks: 0 })),
    now,
  );
  const yearly = new Map<string, YearlyGoalRef>(
    yearlyRows.map((y, i) => [
      y.id,
      { id: y.id, goalText: y.goalText, behind: !verdicts.tooEarly && verdicts.goals[i].status === 'отстаёт' },
    ]),
  );
  return { weekly, yearly };
}

/** Перегруз недели/месяца, если D в текущей неделе/месяце (иначе null). */
async function horizonLines(userId: string, day: string, tz: string, now: Date): Promise<string[]> {
  const out: string[] = [];
  const weekStart = localWeekStartUTC(tz, now);
  const weekStartStr = civil(weekStart);
  if (day >= weekStartStr && day <= addCivilDays(weekStartStr, 6)) {
    const w = await gatherWeekLoad(userId, now);
    const fit = computeCapacityFit(w);
    if (fit.status === 'overloaded') {
      const goals = await prisma.weeklyGoal.findMany({
        where: { userId, weekStart, completed: false, archivedAt: null },
        select: { goalText: true },
        orderBy: { order: 'asc' },
      });
      const line = horizonWarning('week', { demand: fit.totalDemand, capacity: fit.capacity, goals: goals.map((g) => g.goalText) });
      if (line) out.push(line);
    }
  }
  const monthStart = localMonthOnlyUTC(tz, now);
  if (day.slice(0, 7) === civil(monthStart).slice(0, 7)) {
    const m = await gatherMonthLoad(userId, now);
    const fit = computeCapacityFit(m);
    if (fit.status === 'overloaded') {
      const goals = await prisma.monthlyGoal.findMany({
        where: { userId, monthStart, completed: false },
        select: { goalText: true },
        orderBy: { order: 'asc' },
      });
      const line = horizonWarning('month', { demand: fit.totalDemand, capacity: fit.capacity, goals: goals.map((g) => g.goalText) });
      if (line) out.push(line);
    }
  }
  return out;
}

export interface RescheduleProposal {
  text: string;
  moves: ShiftMove[];
  /** true — предложение лежит в PendingAction, ждёт «Подтвердить». */
  staged: boolean;
}

/**
 * День `day` перегружен после добавления/переноса задачи `keepId`? → текст
 * предложения (+ PendingAction с переносами, если есть что двигать). null —
 * флаг выкл., день прошёл или влезает. Best-effort: не бросает.
 */
export async function proposeReschedule(
  userId: string,
  day: string,
  keepId: string | null,
  now: Date = new Date(),
  /** Вызов из карточки (REST), не из хода чата: чужое ожидающее подтверждение
   *  (напр. «Записать 5000₸?») НЕ перетираем — иначе кнопка/«да» сработают
   *  не на то, что юзер видит. */
  opts: { fromCard?: boolean } = {},
): Promise<RescheduleProposal | null> {
  if (!isV2RescheduleEnabled(userId)) return null;
  try {
    const tz = await getUserTimezone(userId);
    const today = localDateStr(tz, now);
    if (day < today) return null;
    const { days, tasks } = await gatherWindow(userId, day, today, localTimeStr(tz, now));
    const plan = planShift(days[0], days.slice(1), keepId);
    if (!plan.overloaded) return null;
    // Сегодня, день на исходе, дел меньше часа — не «перегруз» (прод 2026-11-08:
    // в 21:01 «день перегружен: дел на ~30 мин, свободно ~0» на одну задачу в 22:00).
    if (day === today && plan.demand <= MIN_OVERLOAD_DEMAND) return null;

    const moved = new Set(plan.moves.map((m) => m.taskId));
    const parents: MoveParent[] = tasks
      .filter((t) => moved.has(t.id))
      .map((t) => ({ taskId: t.id, planParentId: t.planParentId, planParentType: t.planParentType }));
    const { weekly, yearly } = await loadGoalRefs(userId, parents, now);
    const warnings = [...goalWarnings(plan.moves, parents, weekly, yearly), ...(await horizonLines(userId, day, tz, now))];

    const dealSteps = days[0].tasks.filter((t) => t.id.startsWith(DEAL_STEP_ID_PREFIX)).length;
    let text = describeProposal({ plan, day, today, warnings, dealSteps });
    let staged = plan.moves.length > 0;
    if (staged && opts.fromCard) {
      const other = await peekPendingAction(userId);
      if (other && other.action !== RESCHEDULE_ACTION) {
        staged = false;
        text = text.replace(/\nПодтвердить перенос\?$/, '\nСначала ответь на прошлое подтверждение — сам я этот перенос потом не предложу.');
      }
    }
    if (staged) await setPendingAction(userId, RESCHEDULE_ACTION, { moves: plan.moves }, text);
    // Из карточки (не из хода чата): кладём предложение в историю чата —
    // робот показывает его облачком, а «да» в чате идёт к тому, что юзер видел
    // (как нудж goal-slot). Из чата ход сам сохранит ответ с этим текстом.
    if (opts.fromCard) {
      await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: text } }).catch(() => {});
    }
    return { text, moves: staged ? plan.moves : [], staged };
  } catch (err) {
    console.warn('[reschedule] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Разбор input из PendingAction (JSON) — только валидные переносы. */
export function parseMoves(input: Record<string, unknown>): ShiftMove[] {
  const raw = Array.isArray(input.moves) ? input.moves : [];
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return raw
    .filter(
      (m): m is ShiftMove =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as ShiftMove).taskId === 'string' &&
        !(m as ShiftMove).taskId.startsWith(DEAL_STEP_ID_PREFIX) && // шаг по сделке — не задача
        typeof (m as ShiftMove).title === 'string' &&
        re.test(String((m as ShiftMove).fromDate)) &&
        re.test(String((m as ShiftMove).toDate)),
    )
    .slice(0, 50);
}

/**
 * «Подтвердить» → двигаем. Только свои, не выполненные/отменённые задачи,
 * всё ещё стоящие на fromDate (юзер мог передвинуть сам — тогда пропуск и
 * честная строка). Атомарно, одной транзакцией.
 */
export async function applyReschedule(userId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<string> {
  const moves = parseMoves(input);
  if (moves.length === 0) return 'Переносить нечего.';
  const today = localDateStr(await getUserTimezone(userId), now);
  const results = await prisma.$transaction(
    moves.map((m) =>
      prisma.task.updateMany({
        where: { id: m.taskId, userId, date: dateOnlyUTC(m.fromDate), completed: false, cancelled: false },
        data: { date: dateOnlyUTC(m.toDate) },
      }),
    ),
  );
  const done = moves.filter((_, i) => results[i].count > 0);
  // Мозг видит правку (как PUT /tasks): каждый перенос — в активность/память.
  for (const m of done) {
    captureActivity(userId, { type: 'task_updated', content: `Перенёс задачу «${m.title}» с ${m.fromDate} на ${m.toDate} (перегруз дня)` });
  }
  const skipped = moves.filter((_, i) => results[i].count === 0);
  const parts: string[] = [];
  if (done.length > 0) {
    parts.push(
      'Готово, график сдвинут: ' + done.map((m) => `«${m.title}» → ${targetPhrase(m.toDate, today)}`).join(', ') + '.',
    );
  }
  if (skipped.length > 0) {
    parts.push(
      skipped.map((m) => `«${m.title}»`).join(', ') +
        (skipped.length > 1 ? ' уже передвинуты или закрыты' : ' уже передвинута или закрыта') +
        ' — оставляю как есть.',
    );
  }
  return parts.join('\n');
}
