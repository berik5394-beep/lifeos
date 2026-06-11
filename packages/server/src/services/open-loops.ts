import { prisma } from '../lib/prisma.js';
import { countOverduePending, listOverduePending } from './task-overdue.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateOnlyUTC, localDayStartUTC } from '../lib/tz.js';

export interface OpenLoops {
  overdueCount: number;
  overdueTitles: string[];
  habitsActive: number;
  habitsUnchecked: number;
  uncheckedHabitNames: string[];
  pendingText: string | null;
}

/**
 * READ-ONLY снимок открытых петель. Сам резолвит таймзону юзера и применяет
 * ПРАВИЛЬНУЮ дату-конвенцию к каждому домену (TZ-баг 2026-06-06):
 *  - задачи (Task.date @db.Date) → localDateOnlyUTC (как 3 прод-вызова countOverduePending);
 *  - привычки (HabitLog.date) → localDayStartUTC — ТОЧНО как пишет complete-habit,
 *    иначе в зонах со смещением «привычка не отмечена» врёт.
 */
export async function gatherOpenLoops(userId: string, now: Date = new Date()): Promise<OpenLoops> {
  const tz = await getUserTimezone(userId);
  const taskToday = localDateOnlyUTC(tz, now); // @db.Date convA — задачи
  const habitToday = localDayStartUTC(tz, now); // зеркало complete-habit — привычки
  const [overdueCount, overdueSample, habits, todayLogs, pending] = await Promise.all([
    countOverduePending(userId, taskToday),
    listOverduePending(userId, taskToday, 3),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    prisma.habitLog.findMany({
      where: { userId, completed: true, date: habitToday },
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
