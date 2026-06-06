import { prisma } from '../../lib/prisma.js';
import { localDateOnlyUTC } from '../../lib/tz.js';
import { getUserTimezone } from '../../lib/user-context.js';
import {
  detectConflicts,
  formatScheduleConflict,
  findOverlaps,
  formatCreationConflict,
  itemWindow,
  type SchedItem,
} from './types.js';

/**
 * Read-only reader конфликтов задача↔календарь на сегодня (кросс-домен слой B).
 * timed незавершённые задачи ∩ окна событий → строка для врезки в мозг, или null.
 */
export async function buildScheduleConflict(userId: string): Promise<string | null> {
  const tz = await getUserTimezone(userId);
  const today = localDateOnlyUTC(tz);
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, completed: false, time: { not: null } },
      select: { title: true, time: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today, startTime: { not: null } },
      select: { title: true, startTime: true, endTime: true },
    }),
  ]);
  const conflicts = detectConflicts(
    tasks.flatMap((t) => (t.time ? [{ title: t.title, time: t.time }] : [])),
    events.flatMap((e) => (e.startTime ? [{ title: e.title, startTime: e.startTime, endTime: e.endTime }] : [])),
  );
  return formatScheduleConflict(conflicts) || null;
}

/**
 * Проактивный конфликт ПРИ СОЗДАНИИ: после записи timed-задачи/события проверяем
 * наложение в тот же день (кроме самого нового элемента) → inline «не успеешь».
 * READ-only. `date` — @db.Date нового элемента (convA). Best-effort.
 */
export async function findCreationConflict(
  userId: string,
  date: Date,
  newItem: SchedItem,
  exclude: { taskId?: string; eventId?: string },
): Promise<string | null> {
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        date,
        completed: false,
        time: { not: null },
        ...(exclude.taskId ? { id: { not: exclude.taskId } } : {}),
      },
      select: { title: true, time: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        userId,
        date,
        startTime: { not: null },
        ...(exclude.eventId ? { id: { not: exclude.eventId } } : {}),
      },
      select: { title: true, startTime: true, endTime: true },
    }),
  ]);
  const others: SchedItem[] = [];
  for (const t of tasks) {
    const w = t.time ? itemWindow('task', t.time, null) : null;
    if (w) others.push({ title: t.title, kind: 'task', ...w });
  }
  for (const e of events) {
    const w = e.startTime ? itemWindow('event', e.startTime, e.endTime) : null;
    if (w) others.push({ title: e.title, kind: 'event', ...w });
  }
  return formatCreationConflict(findOverlaps(newItem, others)) || null;
}
