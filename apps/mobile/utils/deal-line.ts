/**
 * Строка «Новая сделка» прямо в списке: «Ахмет — оборудование 2 млн»,
 * «Дана склад 800к», «Серик». Клиент — до тире (или первое слово), что
 * продаём — дальше, сумма — число в конце (млн / к / тыс).
 */
export function parseDealLine(raw: string): { personName: string; title: string | null; amount: number | null } | null {
  let t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let amount: number | null = null;
  const m = t.match(/\s(\d[\d\s]*(?:[.,]\d+)?)\s*(млн|миллион[а-я]*|к|k|тыс\.?|тысяч[а-я]*)?\s*(?:₸|тг|тенге)?$/i);
  if (m) {
    let n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    const unit = (m[2] ?? '').toLowerCase();
    if (unit.startsWith('млн') || unit.startsWith('миллион')) n *= 1_000_000;
    else if (unit) n *= 1000;
    if (Number.isFinite(n) && n > 0) {
      amount = Math.round(n);
      t = t.slice(0, m.index).trim();
    }
  }
  const dash = t.match(/^(.+?)\s*[—–:-]\s*(.+)$/);
  let personName: string;
  let title: string | null;
  if (dash) {
    personName = dash[1].trim();
    title = dash[2].trim() || null;
  } else {
    const [first, ...rest] = t.split(' ');
    personName = first;
    title = rest.join(' ').trim() || null;
  }
  if (!personName) return null;
  return { personName, title, amount };
}
