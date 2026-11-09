import { prisma } from '../lib/prisma.js';
import { addCivilDays, dateOnlyUTC } from '../lib/tz.js';

/**
 * Живой прогресс годовой цели (аудит 2026-11-09: робот считал денежную цель на
 * лету «40%», а экран показывал сохранённый progress = 0%; привязанные привычки
 * кольцо не двигали, хотя робот обещал «отметки идут в цель»).
 *
 * ОДИН расчёт для экрана и мозга:
 *  - денежная цель: накоплено = доходы − расходы с даты постановки цели
 *    (тот же принцип, что у коуча накоплений, reflector-service);
 *  - привязанные привычки: в сколько из последних N дней была хоть одна отметка —
 *    это РЕГУЛЯРНОСТЬ, а не продвижение к цели, поэтому отдельным полем, не в кольцо.
 */
export async function moneyGoalSaved(userId: string, createdAt: Date): Promise<number> {
  const since = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()));
  const [inc, exp] = await Promise.all([
    prisma.income.aggregate({ where: { userId, date: { gte: since } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { userId, date: { gte: since } }, _sum: { amount: true } }),
  ]);
  return (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
}

/** Процент денежной цели 0..100 из накопленного (минус — 0). */
export function moneyGoalPercent(saved: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

export const HABIT_WINDOW_DAYS = 30;

/**
 * Дни с отметкой привязанных привычек за последние 30 дней (или с первого дня
 * привычки, если она моложе). today — календарный день юзера 'YYYY-MM-DD'.
 */
export async function habitRegularity(
  userId: string,
  habits: Array<{ id: string; createdAt: Date }>,
  today: string,
): Promise<{ done: number; of: number } | null> {
  if (habits.length === 0) return null;
  const windowStart = addCivilDays(today, -(HABIT_WINDOW_DAYS - 1));
  const firstDay = habits.map((h) => h.createdAt.toISOString().slice(0, 10)).sort()[0];
  const from = firstDay > windowStart ? firstDay : windowStart;
  const logs = await prisma.habitLog.findMany({
    where: { userId, habitId: { in: habits.map((h) => h.id) }, completed: true, date: { gte: dateOnlyUTC(from), lte: dateOnlyUTC(today) } },
    select: { date: true },
  });
  const days = new Set(logs.map((l) => l.date.toISOString().slice(0, 10)));
  const of = Math.round((dateOnlyUTC(today).getTime() - dateOnlyUTC(from).getTime()) / 86_400_000) + 1;
  return { done: days.size, of: Math.max(1, of) };
}
