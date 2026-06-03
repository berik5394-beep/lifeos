import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localMonthStartUTC, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2MonthLoadEnabled } from '../lib/feature-flags.js';
import { sumWeekCapacity } from '../tools/_slots.js';
import { computeCapacityFit, type CapacityFit, type CapacityItem } from './capacity-fit.js';
import { mapPriority, DEFAULT_TASK_MINUTES } from './day-load.js';
import { DEFAULT_GOAL_MINUTES } from './estimate-goal-minutes.js';

const DAY_MS = 86_400_000;
const MONTH_LOAD_SCOPE = 'time:month_load';
const GOAL_IMPORTANCE = 2; // у WeeklyGoal нет priority — фикс. средняя

/** Строка о перегрузе месяца. null если влезает. */
export function describeMonthLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `В этом месяце задач и целей примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `на следующий месяц или разгрузить?${keepQ}`
  );
}

/** Собирает ёмкость+спрос МЕСЯЦА (задачи + недельные цели). */
export async function gatherMonthLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  const monthStart = localMonthStartUTC(tz, now);
  const monthEndExcl = localMonthStartUTC(tz, new Date(monthStart.getTime() + 32 * DAY_MS));
  const todayStart = localDayStartUTC(tz, now);

  const [tasks, weeklyGoals, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: { gte: monthStart, lt: monthEndExcl }, completed: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.weeklyGoal.findMany({
      where: { userId, weekStart: { gte: monthStart, lt: monthEndExcl }, completed: false, archivedAt: null },
      select: { goalText: true, estimatedMinutes: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: todayStart, lt: monthEndExcl } },
      select: { date: true, startTime: true, endTime: true },
    }),
  ]);

  const dayKey = (d: Date) => localDayStartUTC(tz, d).getTime();
  const evByDay = new Map<number, Array<{ startTime: string | null; endTime: string | null }>>();
  for (const e of events) {
    const k = dayKey(e.date);
    const arr = evByDay.get(k) ?? [];
    arr.push({ startTime: e.startTime, endTime: e.endTime });
    evByDay.set(k, arr);
  }

  const todayKey = todayStart.getTime();
  const days: Array<{ events: Array<{ startTime: string | null; endTime: string | null }>; isToday: boolean }> = [];
  for (let t = todayStart.getTime(); t < monthEndExcl.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    days.push({ events: evByDay.get(k) ?? [], isToday: k === todayKey });
  }

  const capacity = sumWeekCapacity(days, localTimeStr(tz, now));
  const items: CapacityItem[] = [
    ...tasks.map((t) => ({
      label: t.title,
      demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
      importance: t.importance ?? mapPriority(t.priority),
    })),
    ...weeklyGoals.map((g) => ({
      label: g.goalText,
      demand: g.estimatedMinutes ?? DEFAULT_GOAL_MINUTES,
      importance: GOAL_IMPORTANCE,
    })),
  ];
  return { capacity, items };
}

/** Реактивная строка «месяц перегружен». Best-effort, ≤1/день дедуп против СВОИХ. */
export async function maybeMonthLoadLine(userId: string, now: Date = new Date()): Promise<string | null> {
  if (!isV2MonthLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherMonthLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const seen = await prisma.insight.count({
      where: { userId, scopeKey: MONTH_LOAD_SCOPE, source: 'month_load', createdAt: { gte: dayStart } },
    });
    if (seen > 0) return null;

    const line = describeMonthLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: MONTH_LOAD_SCOPE, kind: 'month_load_reactive' },
          scopeKey: MONTH_LOAD_SCOPE,
          source: 'month_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[month-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}
