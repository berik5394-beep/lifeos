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

/**
 * Срезать хвостовую дату-фразу и висячий предлог. Не опустошает: если результат
 * пустой/пробельный — возвращает trimmed-исходник.
 */
export function sanitizeTaskTitle(raw: string): string {
  const original = raw.trim();
  let out = original.replace(TRAILING_DATE, '').replace(TRAILING_PREP, '').trim();
  if (out.length === 0) return original;
  return out;
}

/**
 * Найти открытую задачу по «грязному» вводу. Чистит обе стороны, матчит
 * ДВУНАПРАВЛЕННО (хранимое⊇запрос ИЛИ запрос⊇хранимое), при нескольких —
 * самый свежий по createdAt. Пустой запрос → null.
 */
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
