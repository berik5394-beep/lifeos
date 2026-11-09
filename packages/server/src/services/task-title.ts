/**
 * Чистые хелперы названий задач. Чинят 2 бага:
 *  A) модель оставляет хвостовой предлог/дату в названии («…отчёт на сегодня»);
 *  B) поиск задачи по «грязному» вводу не находит хранимое (рассинхрон длины).
 * Без БД/сети — юнит-тестируется напрямую.
 */

// Относительные слова-даты (после trim+lowercase).
const DATE_WORDS = 'сегодня|завтра|послезавтра|вчера|позавчера|today|tomorrow|yesterday';
// Предлоги, которые могут «прилипнуть» перед датой или повиснуть в конце.
const PREPS = 'на|в|во|к|ко|до|по|за';

// «… [предлог] дата$» — целиком убираем (включая «на сегодня», «к завтра», «завтра»).
const TRAILING_DATE = new RegExp(`\\s+(?:${PREPS})?\\s*(?:${DATE_WORDS})\\s*$`, 'i');
// Висячий предлог в самом конце («…отчёт на$»).
const TRAILING_PREP = new RegExp(`\\s+(?:${PREPS})\\s*$`, 'i');
// Голова «на завтра: отчёт» / «на : отчёт» (дата уже выдернута) / «— отчёт».
const LEADING_LEAD = new RegExp(`^(?:(?:${PREPS})\\s+)?(?:(?:${DATE_WORDS})\\s*)?[:—–\\-,]\\s*`, 'i');

/**
 * Срезать хвостовую дату-фразу и висячий предлог. Не опустошает: если результат
 * пустой/пробельный — возвращает trimmed-исходник.
 */
export function sanitizeTaskTitle(raw: string): string {
  const original = raw.trim();
  let out = original.replace(LEADING_LEAD, '').replace(TRAILING_DATE, '').replace(TRAILING_PREP, '').trim();
  if (out.length === 0) return original;
  return out;
}

/**
 * Найти открытую задачу по «грязному» вводу. Чистит обе стороны, матчит
 * ДВУНАПРАВЛЕННО (хранимое⊇запрос ИЛИ запрос⊇хранимое), при нескольких —
 * самый свежий по createdAt. Пустой запрос → null.
 */
/**
 * Строгий матч для «сделал X» → задача (когда привычки X нет): ВСЕ слова фразы
 * целыми словами в названии задачи и ровно ОДНА такая задача. Без подстрок
 * («йогу» не находит «Купить йогурт»), без гаданий при двусмысленности.
 */
export function matchTaskByWholeWords<T extends { title: string }>(query: string, candidates: T[]): T | null {
  const words = (s: string) =>
    sanitizeTaskTitle(s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^a-zа-я0-9]+/i)
      .filter(Boolean);
  const q = words(query);
  if (q.length === 0) return null;
  const hits = candidates.filter((c) => {
    const t = new Set(words(c.title));
    return q.every((w) => t.has(w));
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Выбор задачи для «закрой задачу X» без угадывания. Одна подходящая — она;
 * несколько — если ровно одна совпадает названием целиком, она; иначе
 * «какую из?» со списком. Раньше бралась самая свежая молча: при «отчёт для
 * банка» и «отчёт по дому» закрывалась не та, и юзер узнавал об этом позже.
 */
export function pickOpenTask<T extends { title: string; createdAt: Date }>(
  query: string,
  candidates: T[],
): { kind: 'one'; task: T } | { kind: 'many'; tasks: T[] } | { kind: 'none' } {
  const q = sanitizeTaskTitle(query).toLowerCase();
  if (q.length === 0) return { kind: 'none' };
  const matches = candidates.filter((c) => {
    const t = sanitizeTaskTitle(c.title).toLowerCase();
    return t.length > 0 && (t.includes(q) || q.includes(t));
  });
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'one', task: matches[0] };
  const exact = matches.filter((c) => sanitizeTaskTitle(c.title).toLowerCase() === q);
  if (exact.length === 1) return { kind: 'one', task: exact[0] };
  const newestFirst = [...matches].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { kind: 'many', tasks: newestFirst.slice(0, 5) };
}

export function matchOpenTask<T extends { title: string; createdAt: Date }>(
  query: string,
  candidates: T[],
): T | null {
  const q = sanitizeTaskTitle(query).toLowerCase();
  if (q.length === 0) return null;
  const matches = candidates.filter((c) => {
    const t = sanitizeTaskTitle(c.title).toLowerCase();
    return t.length > 0 && (t.includes(q) || q.includes(t));
  });
  if (matches.length === 0) return null;
  return matches.reduce((best, c) =>
    c.createdAt.getTime() > best.createdAt.getTime() ? c : best,
  );
}
