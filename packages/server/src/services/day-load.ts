import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { availableMinutesToday } from '../tools/_slots.js';
import { type CapacityItem } from './capacity-fit.js';
import { estimateTaskMinutes } from './estimate-task-minutes.js';
import { dealStepLoadItems } from './deals/service.js';

export const DEFAULT_TASK_MINUTES = 30;

/** priority-строка → числовая важность (для защиты важных задач). */
export function mapPriority(priority: string): number {
  if (priority === 'critical' || priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}


/** Собирает ёмкость+спрос дня из БД (спрос = estimatedMinutes ?? дефолт). */
export async function gatherDayLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  // FIX 2026-06-06: @db.Date task/event «сегодня» → UTC-полночь календарной даты.
  const today = localDateOnlyUTC(tz, now);
  const [tasks, events, dealSteps] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, completed: false, cancelled: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      select: { startTime: true, endTime: true },
    }),
    // Шаги по сделкам на сегодня — тоже время дня.
    dealStepLoadItems(userId, today, new Date(today.getTime() + 86_400_000)),
  ]);
  const capacity = availableMinutesToday(events, localTimeStr(tz, now));
  const items: CapacityItem[] = [
    ...tasks.map((t) => ({
      label: t.title,
      demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
      importance: t.importance ?? mapPriority(t.priority),
    })),
    ...dealSteps,
  ];
  return { capacity, items };
}

/**
 * Фоновая оценка времени задачи (только если ещё не задана).
 * Fire-and-forget — не блокирует ответ create_task.
 */
export async function estimateTaskMinutesInBackground(
  taskId: string,
  title: string,
  category: string | null,
  userId: string,
): Promise<void> {
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
