import { numbersIn } from './number-honesty.js';

/**
 * Числа в ответе чата, которые — утверждения о делах пользователя: суммы
 * («12 000 ₸»), счётчики («3 задачи», «5 привычек», «7 дней подряд»),
 * «осталось / потратил / лимит N». Обычные числа совета («3 подхода»,
 * «365 дней в году») не трогаем — их проверять не с чем.
 *
 * Пока только ЗАПИСЬ (лог): сколько таких чисел не нашлось в данных хода.
 * Исправлять ответ начнём, когда увидим, как часто срабатывает и не ловит ли
 * лишнее (числа из поиска в интернете в данные хода не попадают).
 */
// \b не работает с кириллицей — границы слова через (?![а-яё]).
const NUM = String.raw`\d[\d\s]*\d|\d`;
const AFTER = String.raw`(?:₸|тенге|тг(?![а-яё])|тыс|задач|привыч|дел[аоу]?(?![а-яё])|встреч|дн(?:ей|я)\s+подряд|раз(?:а)?\s+подряд|шаг|расход|покуп)`;
const BEFORE = String.raw`(?:осталось|остаток|потратил[аи]?|потрачено|трат[аы]?|баланс|лимит|бюджет|долг|накопил[аи]?|выполнил[аи]?|закрыл[аи]?|сделал[аи]?|серия)`;

const RE_AFTER = new RegExp(`(${NUM})\\s*${AFTER}`, 'giu');
const RE_BEFORE = new RegExp(`${BEFORE}[^\\d\\n]{0,20}(${NUM})`, 'giu');

/** Числа-утверждения о данных пользователя (нормализованы: без пробелов). */
export function userNumberClaims(reply: string): string[] {
  const out = new Set<string>();
  for (const re of [RE_AFTER, RE_BEFORE]) {
    for (const m of reply.matchAll(re)) out.add(m[1].replace(/\s/g, ''));
  }
  return [...out];
}

/** Утверждения, которых нет ни в одном источнике хода (контекст, слова пользователя, инструменты). */
export function ungroundedClaims(reply: string, sources: string[]): string[] {
  const claims = userNumberClaims(reply);
  if (claims.length === 0) return [];
  const known = new Set(numbersIn(sources.join('\n')));
  return claims.filter((n) => !known.has(n));
}
