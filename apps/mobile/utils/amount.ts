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
