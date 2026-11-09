/**
 * Прогресс годовой цели хранится на сервере в ПРОЦЕНТАХ 0..100 (валидация
 * маршрута, голосовой update_goal_progress, темп цели). Экран «Цели» раньше
 * считал его долей 0..1: «+» добавлял 0,1%, а цель, обновлённая голосом до
 * 50, показывалась как 5000%. Старые записи-доли (дробные < 1) читаем как долю — то
 * же правило, что normalizePct на сервере (plan-vs-fact).
 */
export function goalPercent(progress: number | null | undefined): number {
  const p = Number(progress ?? 0);
  if (!Number.isFinite(p) || p <= 0) return 0;
  // Аудит 2026-11-09: целое 1 — это 1% («1 книга из 100»), а не «100% выполнено».
  // Долей считаем только старые дробные записи меньше 1 (0.35 → 35%).
  return Math.min(100, Math.round(p < 1 && !Number.isInteger(p) ? p * 100 : p));
}

/** Шаг кнопок «−/+» на карточке цели, в процентах. */
export const GOAL_STEP_PCT = 10;

/**
 * Процент, который показывает кольцо: у денежной цели — живой (накоплено с даты
 * цели, тот же расчёт, что у робота), иначе сохранённый (аудит 2026-11-09:
 * робот говорил «40%», экран — 0%).
 */
export function effectiveGoalPercent(g: { progress: number | null | undefined; liveProgress?: number | null }): number {
  return g.liveProgress != null ? Math.max(0, Math.min(100, Math.round(g.liveProgress))) : goalPercent(g.progress);
}
