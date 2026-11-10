/**
 * Даты в памяти — числом, «сегодня/завтра» — при чтении (Berik 2026-11-10):
 * «сегодня 9-е, говорит „завтра“ — в память ставится 10-е; когда число совпадает
 * с сегодняшним — значит „сегодня“; так же вчера, прошлая неделя…».
 * Экстрактор пишет конкретную дату; здесь к ней дописывается, чем она приходится
 * СЕГОДНЯ по календарю человека: «11 ноября (завтра)». Чистые функции.
 */
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAY_MS = 86_400_000;

/** Разница в днях между гражданскими датами 'YYYY-MM-DD' (a − b). */
export function civilDiffDays(a: string, b: string): number {
  return diffDays(a, b);
}
function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** Чем дата приходится относительно сегодня: 0 → «сегодня», 1 → «завтра», −8 → «на прошлой неделе»… */
export function relativeLabel(days: number): string {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  if (days === 2) return 'послезавтра';
  if (days === -2) return 'позавчера';
  if (days > 0 && days < 7) return `через ${days} дн.`;
  if (days < 0 && days > -7) return `${-days} дн. назад`;
  if (days >= 7 && days < 14) return 'на следующей неделе';
  if (days <= -7 && days > -14) return 'на прошлой неделе';
  if (days > 0 && days < 60) return `через ${Math.round(days / 7)} нед.`;
  if (days < 0 && days > -60) return `${Math.round(-days / 7)} нед. назад`;
  const months = Math.round(Math.abs(days) / 30);
  return days > 0 ? `через ${months} мес.` : `${months} мес. назад`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Год для «11 ноября» без года: ближайший к сегодня (декабрь → январь не уедет на год). */
function nearestYear(month: number, day: number, today: string): number {
  const y = Number(today.slice(0, 4));
  const best = [y - 1, y, y + 1]
    .map((yy) => ({ yy, d: Math.abs(diffDays(`${yy}-${pad(month)}-${pad(day)}`, today)) }))
    .sort((a, b) => a.d - b.d)[0];
  return best.yy;
}

const RU_DATE = new RegExp(`(?<![\\d])(\\d{1,2})\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4})(?:\\s*г(?:ода|\\.)?)?)?(?!\\s*\\()`, 'gi');
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])(?!\s*\()/g;

/**
 * Дописать к каждой дате в тексте, чем она является сегодня: «Собеседование
 * 11 ноября» → «Собеседование 11 ноября (завтра)». Уже подписанное не трогает.
 */
export function annotateRelativeDates(text: string, today: string): string {
  let out = text.replace(RU_DATE, (m, d: string, mon: string, yr?: string) => {
    const month = MONTHS.indexOf(mon.toLowerCase()) + 1;
    const day = Number(d);
    if (month < 1 || day < 1 || day > 31) return m;
    const year = yr ? Number(yr) : nearestYear(month, day, today);
    return `${m} (${relativeLabel(diffDays(`${year}-${pad(month)}-${pad(day)}`, today))})`;
  });
  out = out.replace(ISO_DATE, (m, y: string, mo: string, d: string) => `${m} (${relativeLabel(diffDays(`${y}-${mo}-${d}`, today))})`);
  return out;
}

/** «9 ноября» из 'YYYY-MM-DD'. */
export function ruDate(civil: string): string {
  return `${Number(civil.slice(8, 10))} ${MONTHS[Number(civil.slice(5, 7)) - 1]}`;
}
