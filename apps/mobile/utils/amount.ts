/**
 * «5000 обед», «5 000», «5к такси», «1,5к», «12 500 ₸ кофе» → сумма + пометка.
 * Для записи траты/дохода прямо в строке (тап по категории/источнику).
 */
export function parseAmountNote(raw: string): { amount: number; note: string } | null {
  const t = raw.trim().replace(/₸|тг|тенге/gi, ' ');
  const m = t.match(/^(\d[\d\s]*(?:[.,]\d+)?)\s*(к|k|тыс\.?)?(?=\s|$)\s*(.*)$/i);
  if (!m) return null;
  let amount = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  if (m[2]) amount *= 1000;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount: Math.round(amount), note: m[3].trim() };
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
