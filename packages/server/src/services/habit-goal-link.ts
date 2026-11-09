import { prisma } from '../lib/prisma.js';
import { calculateStreak } from './streak-service.js';

/**
 * «Привычка → цель»: к какой годовой цели ведёт отмеченная привычка и какая
 * сейчас серия. ОДИН источник для робота (complete_habit: «…— это к цели X,
 * серия N дней») и для экрана (POST /habits/:id/log → облачко робота).
 * Раньше это знал только мозг: отметка тапом давала лишь улыбку (2026-11-09).
 *
 * null — привычка не привязана к цели / флаг выкл. / цель не найдена.
 * Best-effort: ошибка не должна ломать отметку.
 */
export async function habitGoalLink(
  userId: string,
  goalId: string | null | undefined,
): Promise<{ goalText: string; streak: number } | null> {
  if (!goalId) return null;
  try {
    const [goal, streak] = await Promise.all([
      // userId — вторая линия защиты: старые привязки к чужой цели (до IDOR-фикса /habits).
      prisma.yearlyGoal.findFirst({ where: { id: goalId, userId }, select: { goalText: true } }),
      calculateStreak(userId),
    ]);
    return goal ? { goalText: goal.goalText, streak } : null;
  } catch {
    return null;
  }
}

/** «2 дня», «5 дней», «21 день». */
export function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/** Облачко робота после отметки с экрана. */
export function habitGoalReactionText(habitName: string, link: { goalText: string; streak: number }): string {
  const streak = link.streak > 0 ? ` Серия — ${daysWord(link.streak)}.` : '';
  return `«${habitName}» — шаг к цели «${link.goalText}».${streak}`;
}
