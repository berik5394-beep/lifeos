import { localDateOnlyUTC, localDateStr, addCivilDays, dateOnlyUTC } from '../lib/tz.js';

/**
 * День отметки привычки (аудит 2026-11-09): «сделал зарядку вчера» раньше
 * отмечалось СЕГОДНЯ с ответом «отмечена ✅». Приложение задним числом отмечать
 * умеет — мозг теперь тоже: date — календарный день юзера, не будущее, не
 * старше 30 дней. Без date — сегодня (как было).
 */
export function resolveHabitDay(tz: string, date?: string): { day: Date; label: string } {
  if (!date) return { day: localDateOnlyUTC(tz), label: '' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Дата отметки — в формате YYYY-MM-DD.');
  const today = localDateStr(tz);
  if (date > today) throw new Error('Отметить привычку наперёд нельзя — только сегодня или за прошедшие дни.');
  if (date < addCivilDays(today, -30)) throw new Error('Отметить можно только за последние 30 дней.');
  if (date === today) return { day: dateOnlyUTC(date), label: '' };
  const label = date === addCivilDays(today, -1) ? ' за вчера' : ` за ${date.slice(8, 10)}.${date.slice(5, 7)}`;
  return { day: dateOnlyUTC(date), label };
}
