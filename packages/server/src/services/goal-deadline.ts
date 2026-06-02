/**
 * Чистый парсер срока из текста цели. «к декабрю», «к концу года»,
 * «до июня 2027». Нет даты → null (адаптер подставит 31 дек). `now`
 * инжектируется → тестируется без часов.
 */
const MONTH_STEMS: Array<[string, number]> = [
  ['январ', 0], ['феврал', 1], ['март', 2], ['апрел', 3],
  ['ма', 4], ['июн', 5], ['июл', 6], ['август', 7],
  ['сентябр', 8], ['октябр', 9], ['ноябр', 10], ['декабр', 11],
];

export function parseGoalDeadline(text: string, now: Date): Date | null {
  const t = text.toLowerCase();
  if (/(к|до)\s+конц[а-яё]*\s+год/.test(t)) {
    return new Date(now.getFullYear(), 11, 31);
  }
  // «к концу месяца» → последний день текущего месяца (фраза из SMOKE).
  if (/(к|до)\s+конц[а-яё]*\s+месяц/.test(t)) {
    return new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  const m = t.match(/(?:к|до)\s+([а-яё]+)(?:\s+(\d{4}))?/);
  if (m) {
    const word = m[1];
    for (const [stem, idx] of MONTH_STEMS) {
      if (word.startsWith(stem)) {
        const year = m[2] ? Number(m[2]) : now.getFullYear();
        // последний день месяца: день 0 следующего месяца
        return new Date(year, idx + 1, 0);
      }
    }
  }
  return null;
}
