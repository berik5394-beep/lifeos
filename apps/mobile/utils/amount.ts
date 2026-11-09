/**
 * «5000 обед», «5 000», «5к такси», «1,5к», «12 500 ₸ кофе» → сумма + пометка.
 * Для записи траты/дохода прямо в строке (тап по категории/источнику).
 */
export function parseAmountNote(raw: string): { amount: number; note: string } | null {
  const t = raw.trim().replace(/₸|тг|тенге/gi, ' ').replace(/\s+/g, ' ').trim();
  // Аудит 2026-11-09: «2 млн» → 2 ₸, «500 к чаю» → 500 000 ₸, «3000 2 порции» → 30 002 ₸.
  // Пробел внутри числа — только разряды по 3 цифры («5 000», «1 500 000»);
  // «к/k» — только слитно с числом («5к»; «500 к чаю» — предлог); тыс/млн — и через пробел.
  const m = t.match(
    /^(\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:(к|k)(?=\s|$)|\s?(тыс(?:\.|яч[аи]?)?|млн\.?|миллион(?:а|ов)?|лям(?:а|ов)?)(?=\s|$))?\s*(.*)$/i,
  );
  if (!m) return null;
  let amount = Number(m[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
  if (m[2]) amount *= 1000;
  else if (m[3]) amount *= /^(млн|миллион|лям)/i.test(m[3]) ? 1_000_000 : 1000;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount: Math.round(amount), note: m[4].trim() };
}

/**
 * Строка категории трат: «5000 обед» — трата, «лимит 50000» — лимит месяца.
 */
export function parseCategoryEntry(
  raw: string,
): { kind: 'limit'; amount: number } | { kind: 'expense'; amount: number; note: string } | null {
  const lim = raw.trim().match(/^лимит\s+(.+)$/i);
  if (lim) {
    const a = parseAmountNote(lim[1]);
    return a ? { kind: 'limit', amount: a.amount } : null;
  }
  const a = parseAmountNote(raw);
  return a ? { kind: 'expense', amount: a.amount, note: a.note } : null;
}

/**
 * Дата записи из таблиц месяца: смотришь текущий месяц — сегодня; прошлый —
 * его последний день; будущий — первый (иначе запись не видна в этом месяце).
 */
export function entryDateForMonth(viewed: Date, today: Date = new Date()): Date {
  const vy = viewed.getFullYear();
  const vm = viewed.getMonth();
  if (vy === today.getFullYear() && vm === today.getMonth()) return today;
  const isPast = vy < today.getFullYear() || (vy === today.getFullYear() && vm < today.getMonth());
  return isPast ? new Date(vy, vm + 1, 0) : new Date(vy, vm, 1);
}
