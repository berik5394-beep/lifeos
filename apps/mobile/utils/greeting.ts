/**
 * Приветствие по часу (как на сервере, services/today-brief.ts): первое
 * открытие за день бывает и вечером — «Доброе утро» в 17:26 (Berik 2026-11-09).
 */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}
