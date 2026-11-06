/**
 * Одна шкала настроения на всё приложение: 1–10 (как на сервере, в голосе
 * «настроение 8» и в подсказках ИИ). На экране — 5 смайликов, каждый = пара
 * значений. Раньше дневник писал 2/4/6/8/10, а «Привычки» и «Сегодня» — 1–5:
 * сохранённое в одном месте не показывалось в другом.
 */
export const MOOD_LEVELS = [
  { emoji: '😫', label: 'Ужасно', value: 2 },
  { emoji: '😕', label: 'Плохо', value: 4 },
  { emoji: '😐', label: 'Нормально', value: 6 },
  { emoji: '🙂', label: 'Хорошо', value: 8 },
  { emoji: '😄', label: 'Отлично', value: 10 },
] as const;

/** Номер смайлика (0–4) для значения 1–10; нет значения — null. */
export function moodLevel(value: number | null | undefined): number | null {
  if (value == null || value < 1) return null;
  return Math.min(MOOD_LEVELS.length - 1, Math.ceil(Math.min(value, 10) / 2) - 1);
}

export function moodEmoji(value: number | null | undefined): string {
  const level = moodLevel(value);
  return level == null ? '—' : MOOD_LEVELS[level].emoji;
}
