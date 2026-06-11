import { prisma } from '../lib/prisma.js';
import { countOverduePending, listOverduePending } from './task-overdue.js';

export interface OpenLoops {
  overdueCount: number;
  overdueTitles: string[];
  habitsActive: number;
  habitsUnchecked: number;
  uncheckedHabitNames: string[];
  pendingText: string | null;
}

/** READ-ONLY снимок открытых петель. todayStart — UTC-instant начала локального дня. */
export async function gatherOpenLoops(userId: string, todayStart: Date): Promise<OpenLoops> {
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const [overdueCount, overdueSample, habits, todayLogs, pending] = await Promise.all([
    countOverduePending(userId, todayStart),
    listOverduePending(userId, todayStart, 3),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    prisma.habitLog.findMany({
      where: { userId, completed: true, date: { gte: todayStart, lt: tomorrow } },
      select: { habitId: true },
    }),
    prisma.pendingAction.findUnique({ where: { userId }, select: { confirmationText: true } }).catch(() => null),
  ]);
  const doneIds = new Set(todayLogs.map((l) => l.habitId));
  const unchecked = habits.filter((h) => !doneIds.has(h.id));
  return {
    overdueCount,
    overdueTitles: overdueSample.map((t) => t.title),
    habitsActive: habits.length,
    habitsUnchecked: unchecked.length,
    uncheckedHabitNames: unchecked.slice(0, 3).map((h) => h.name),
    pendingText: pending?.confirmationText ?? null,
  };
}

/** Чистый форматтер блока. null если всё закрыто. */
export function formatOpenLoopsSection(l: OpenLoops): string | null {
  const parts: string[] = [];
  if (l.overdueCount > 0) {
    const more = l.overdueCount > l.overdueTitles.length ? ', …' : '';
    const names = l.overdueTitles.length ? ` (${l.overdueTitles.join(', ')}${more})` : '';
    parts.push(`просрочено ${l.overdueCount}${names}`);
  }
  if (l.habitsUnchecked > 0) {
    const names = l.uncheckedHabitNames.length ? ` (${l.uncheckedHabitNames.join(', ')})` : '';
    parts.push(`привычки ${l.habitsUnchecked}/${l.habitsActive} не отмечены${names}`);
  }
  if (l.pendingText) parts.push('ждёт подтверждение');
  if (parts.length === 0) return null;
  return `Открыто сейчас: ${parts.join('; ')}.`;
}

/** Порог проактивного нуджа (тюнится). */
export const OPEN_LOOP_OVERDUE_THRESHOLD = 4;
export const OPEN_LOOP_TOTAL_THRESHOLD = 6;
export function shouldNudgeOpenLoops(l: OpenLoops): boolean {
  const total = l.overdueCount + l.habitsUnchecked + (l.pendingText ? 1 : 0);
  return l.overdueCount >= OPEN_LOOP_OVERDUE_THRESHOLD || total >= OPEN_LOOP_TOTAL_THRESHOLD;
}
