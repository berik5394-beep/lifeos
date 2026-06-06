import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localDateOnlyUTC, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2DayLoadEnabled } from '../lib/feature-flags.js';
import { availableMinutesToday } from '../tools/_slots.js';
import {
  computeCapacityFit,
  type CapacityFit,
  type CapacityItem,
} from './capacity-fit.js';
import { estimateTaskMinutes } from './estimate-task-minutes.js';

export const DEFAULT_TASK_MINUTES = 30;
const DAY_LOAD_SCOPE = 'time:day_load';

/** priority-строка → числовая важность (для защиты важных задач). */
export function mapPriority(priority: string): number {
  if (priority === 'critical' || priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

/** Человеческая строка о перегрузе дня. null если влезает (молчим). */
export function describeDayLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `На сегодня задач примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `на завтра?${keepQ}`
  );
}

/** Собирает ёмкость+спрос дня из БД (спрос = estimatedMinutes ?? дефолт). */
export async function gatherDayLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  // FIX 2026-06-06: @db.Date task/event «сегодня» → UTC-полночь календарной даты.
  const today = localDateOnlyUTC(tz, now);
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, completed: false, cancelled: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      select: { startTime: true, endTime: true },
    }),
  ]);
  const capacity = availableMinutesToday(events, localTimeStr(tz, now));
  const items: CapacityItem[] = tasks.map((t) => ({
    label: t.title,
    demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
    importance: t.importance ?? mapPriority(t.priority),
  }));
  return { capacity, items };
}

/**
 * Реактивная строка после добавления задачи: день перегружен? Best-effort
 * (→null), гейт только overloaded, дедуп ≤1/день против СВОИХ
 * (source 'day_load' — урок бага денег). Зеркало maybeSavingsCoachLine.
 */
export async function maybeDayLoadLine(
  userId: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2DayLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherDayLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const coachedToday = await prisma.insight.count({
      where: { userId, scopeKey: DAY_LOAD_SCOPE, source: 'day_load', createdAt: { gte: dayStart } },
    });
    if (coachedToday > 0) return null;

    const line = describeDayLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: DAY_LOAD_SCOPE, kind: 'day_load_reactive' },
          scopeKey: DAY_LOAD_SCOPE,
          source: 'day_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[day-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Фоновая оценка времени задачи (только если ещё не задана). Гейт флагом.
 * Fire-and-forget — не блокирует ответ create_task.
 */
export async function estimateTaskMinutesInBackground(
  taskId: string,
  title: string,
  category: string | null,
  userId: string,
): Promise<void> {
  if (!isV2DayLoadEnabled(userId)) return;
  try {
    const minutes = await estimateTaskMinutes(title, category);
    await prisma.task.updateMany({
      where: { id: taskId, estimatedMinutes: null },
      data: { estimatedMinutes: minutes },
    });
  } catch {
    /* best-effort */
  }
}
