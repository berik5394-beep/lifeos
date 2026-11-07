/**
 * Прогресс годовой цели хранится на сервере в ПРОЦЕНТАХ 0..100 (валидация
 * маршрута, голосовой update_goal_progress, темп цели). Экран «Цели» раньше
 * считал его долей 0..1: «+» добавлял 0,1%, а цель, обновлённая голосом до
 * 50, показывалась как 5000%. Старые записи-доли (≤1) читаем как долю — то
 * же правило, что normalizePct на сервере (plan-vs-fact).
 */
export function goalPercent(progress: number | null | undefined): number {
  const p = Number(progress ?? 0);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.min(100, Math.round(p > 1 ? p : p * 100));
}

/** Шаг кнопок «−/+» на карточке цели, в процентах. */
export const GOAL_STEP_PCT = 10;
