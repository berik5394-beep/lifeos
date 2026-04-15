import { prisma } from '../lib/prisma.js';

/**
 * Habit completion streak: consecutive days where >50% of the user's active
 * habits were completed.
 *
 * Single findMany over a 365-day window + O(n) reduce, replacing the legacy
 * implementation that made 366 sequential Prisma count() calls per chat/voice/
 * export request.
 *
 * Grace: today with zero completions yet doesn't break an existing streak
 * (user may not have checked in).
 */
export async function calculateStreak(userId: string): Promise<number> {
  const activeHabits = await prisma.habit.count({
    where: { userId, active: true },
  });
  if (activeHabits === 0) return 0;

  const threshold = activeHabits * 0.5;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setDate(from.getDate() - 365);

  const logs = await prisma.habitLog.findMany({
    where: {
      userId,
      completed: true,
      date: { gte: from, lte: today },
    },
    select: { date: true },
  });

  // Group by day key (YYYY-MM-DD)
  const byDay = new Map<string, number>();
  for (const { date } of logs) {
    const key = date.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = byDay.get(key) ?? 0;

    if (count > threshold) {
      streak++;
      continue;
    }
    // Grace for today
    if (i === 0 && count === 0) continue;
    break;
  }
  return streak;
}

/**
 * Weekly completion rate for tasks.
 * Preserves the legacy return range (0-1 decimal) so existing template literals
 * like `${Math.round(weekProgress * 100)}%` keep working.
 */
export async function calculateWeekProgress(
  userId: string,
  today: Date = new Date(),
): Promise<number> {
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekTasks = await prisma.task.findMany({
    where: { userId, date: { gte: weekStart, lt: weekEnd } },
    select: { completed: true },
  });

  if (weekTasks.length === 0) return 0;
  const completed = weekTasks.filter((t) => t.completed).length;
  return completed / weekTasks.length;
}
