import { prisma } from '../../lib/prisma.js';
import { localDateOnlyUTC } from '../../lib/tz.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { detectConflicts, formatScheduleConflict } from './types.js';

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
