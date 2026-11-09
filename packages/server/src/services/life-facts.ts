import { localDateStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isMoneyGoal } from './goal-pace.js';
import { moneyGoalPercent, moneyGoalSaved } from './goal-live-progress.js';

/**
 * Общие «факты жизни» для всех рассказчиков робота — бриф, чат, «Объясни
 * вкладку», «Каким я тебя вижу», «Разбор», «как я иду к цели» (робот = одно
 * приложение, Berik 2026-11-09). Раньше каждый считал по-своему: экран целей —
 * реально накопленное, а чат/портрет/разбор — сохранённое число (обычно 0 %);
 * портрет и разбор считали отменённые задачи и брали год по UTC.
 */

/** Какие задачи считаются в любой статистике: отменённые — не дело и не провал. */
export const COUNTABLE_TASK = { cancelled: false } as const;

/** Сегодня и год — по часам пользователя (в Алматы 1 января в 03:00 уже новый год). */
export async function userCalendar(userId: string, now: Date = new Date()): Promise<{ tz: string; today: string; year: number }> {
  const tz = await getUserTimezone(userId);
  const today = localDateStr(tz, now);
  return { tz, today, year: Number(today.slice(0, 4)) };
}

export interface GoalForProgress {
  area: string;
  progress: number;
  target?: number | null;
  createdAt?: Date | null;
}

/**
 * Прогресс годовой цели в процентах 0..100 — ОДИН расчёт для экрана и мозга.
 * Денежная цель с суммой — по накопленному с даты постановки (как на экране
 * целей, routes/goals.ts), остальные — сохранённый progress.
 */
export async function goalLivePercent(userId: string, g: GoalForProgress): Promise<number> {
  if (isMoneyGoal(g.area, g.target ?? null) && g.target != null && g.createdAt) {
    return moneyGoalPercent(await moneyGoalSaved(userId, g.createdAt), g.target);
  }
  return Math.max(0, Math.min(100, Math.round(g.progress)));
}

/** Те же цели, но progress — живой (см. goalLivePercent). */
export async function withLiveProgress<T extends GoalForProgress>(userId: string, goals: T[]): Promise<T[]> {
  return Promise.all(goals.map(async (g) => ({ ...g, progress: await goalLivePercent(userId, g) })));
}
