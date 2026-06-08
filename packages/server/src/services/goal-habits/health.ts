import { prisma } from '../../lib/prisma.js';
import type { GoalHabitHealth } from './types.js';

const DAY_MS = 86_400_000;

/**
 * Здоровье целей через их привычки. READ-ONLY. Для каждой YearlyGoal текущего
 * года с привязанными активными привычками — давность последней отметки HabitLog.
 */
export async function buildGoalHabitHealth(
  userId: string,
  now: Date = new Date(),
): Promise<GoalHabitHealth[]> {
  const year = now.getUTCFullYear();
  const goals = await prisma.yearlyGoal.findMany({
    where: { userId, year },
    select: {
      id: true,
      goalText: true,
      habits: { where: { active: true }, select: { id: true } },
    },
  });
  const out: GoalHabitHealth[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const g of goals) {
    const habitIds = g.habits.map((h) => h.id);
    if (habitIds.length === 0) continue;
    const last = await prisma.habitLog.findFirst({
      where: { userId, habitId: { in: habitIds }, completed: true },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    // #4 честность: null = ни разу не отмечали (раньше сентинел 9999 →
    // рендерилось «9999 дн без отметок»).
    const daysSince = last
      ? Math.max(0, Math.floor((today - last.date.getTime()) / DAY_MS))
      : null;
    out.push({
      goalId: g.id,
      goalText: g.goalText,
      linkedHabitCount: habitIds.length,
      daysSinceLastCompletion: daysSince,
    });
  }
  return out;
}
