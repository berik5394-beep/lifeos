import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localDayOfWeek, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2WeekLoadEnabled } from '../lib/feature-flags.js';
import { sumWeekCapacity } from '../tools/_slots.js';
import { computeCapacityFit, type CapacityFit, type CapacityItem } from './capacity-fit.js';
import { mapPriority, DEFAULT_TASK_MINUTES } from './day-load.js';

const DAY_MS = 86_400_000;
const WEEK_LOAD_SCOPE = 'time:week_load';

/** Строка о перегрузе недели. null если влезает. */
export function describeWeekLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `На этой неделе задач примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `или разнести по дням?${keepQ}`
  );
}

/** Собирает ёмкость+спрос НЕДЕЛИ (пн–вс локально). */
export async function gatherWeekLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  const todayStart = localDayStartUTC(tz, now);
  const daysFromMon = (localDayOfWeek(tz, now) + 6) % 7; // 0=Sun..6=Sat → Mon-offset
  const weekStart = new Date(todayStart.getTime() - daysFromMon * DAY_MS);
  const weekEndExcl = new Date(weekStart.getTime() + 7 * DAY_MS); // next Monday 00:00

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: { gte: weekStart, lt: weekEndExcl }, completed: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: todayStart, lt: weekEndExcl } },
      select: { date: true, startTime: true, endTime: true },
    }),
  ]);

  // События по локальному дню (нормализуем к local-day-start instant — устойчиво
  // к тому, как хранится CalendarEvent.date).
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
  for (let t = todayStart.getTime(); t < weekEndExcl.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    days.push({ events: evByDay.get(k) ?? [], isToday: k === todayKey });
  }

  const capacity = sumWeekCapacity(days, localTimeStr(tz, now));
  const items: CapacityItem[] = tasks.map((t) => ({
    label: t.title,
    demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
    importance: t.importance ?? mapPriority(t.priority),
  }));
  return { capacity, items };
}

/** Реактивная строка «неделя перегружена». Best-effort, ≤1/день дедуп против СВОИХ. */
export async function maybeWeekLoadLine(userId: string, now: Date = new Date()): Promise<string | null> {
  if (!isV2WeekLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherWeekLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const seen = await prisma.insight.count({
      where: { userId, scopeKey: WEEK_LOAD_SCOPE, source: 'week_load', createdAt: { gte: dayStart } },
    });
    if (seen > 0) return null;

    const line = describeWeekLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: WEEK_LOAD_SCOPE, kind: 'week_load_reactive' },
          scopeKey: WEEK_LOAD_SCOPE,
          source: 'week_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[week-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}
