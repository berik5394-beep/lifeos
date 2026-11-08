/**
 * Привычка закрывается САМА по шагам из «Здоровья» («Ходьба» — при 8 000 шагов).
 * Habit.autoComplete был в схеме, но его никто не читал и не настраивал
 * (аудит проводки 2026-11-08). Формат строгий: { type: 'steps', min }.
 * Закрываем только если за этот день отметки ещё НЕТ — снятую вручную
 * галочку не возвращаем (ручной выбор важнее). Отметка = как с экрана:
 * монеты (за сегодня), память мозга, цель (через привязку привычки).
 */
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { onHabitDone } from './coins.js';
import { captureActivity } from './tool-activity-summary.js';

export const MIN_AUTO_STEPS = 500;
export const MAX_AUTO_STEPS = 100_000;

/** Единственный допустимый формат настройки (REST и инструмент мозга). */
export const habitAutoCompleteSchema = z
  .object({
    type: z.literal('steps'),
    min: z.number().int().min(MIN_AUTO_STEPS).max(MAX_AUTO_STEPS),
  })
  .strict();

/** Порог шагов из JSON привычки или null (нет / мусор — не закрываем). */
export function autoStepsOf(json: unknown): number | null {
  const r = habitAutoCompleteSchema.safeParse(json);
  return r.success ? r.data.min : null;
}

const fmt = (n: number) => n.toLocaleString('ru-RU');

/**
 * Пришли шаги за день → закрыть привычки с порогом ≤ шагов. Возвращает
 * имена закрытых (для облачка робота). Best-effort: сбой → [].
 */
export async function closeHabitsBySteps(
  userId: string,
  civilDate: string,
  steps: number,
): Promise<string[]> {
  try {
    const date = new Date(`${civilDate}T00:00:00Z`);
    const habits = await prisma.habit.findMany({
      where: { userId, active: true, autoComplete: { path: ['type'], equals: 'steps' } },
      select: { id: true, name: true, autoComplete: true },
      take: 50,
    });
    const due = habits.filter((h) => {
      const min = autoStepsOf(h.autoComplete);
      return min != null && steps >= min;
    });
    const closed: string[] = [];
    for (const h of due) {
      // createMany skipDuplicates — атомарно «создать, если отметки нет»: и
      // повторный синк, и ручное «не сделал» (completed:false) остаются как есть.
      const r = await prisma.habitLog.createMany({
        data: [{ habitId: h.id, userId, date, completed: true, autoCompleted: true }],
        skipDuplicates: true,
      });
      if (r.count === 0) continue;
      closed.push(h.name);
      void onHabitDone(userId, h.id, civilDate, h.name).catch(() => {});
      captureActivity(userId, {
        type: 'habit_auto_completed',
        content: `Привычка «${h.name}» отметилась сама: ${fmt(steps)} шагов (порог ${fmt(autoStepsOf(h.autoComplete) ?? 0)})`,
      });
    }
    return closed;
  } catch (err) {
    console.warn('[habit-auto] failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
