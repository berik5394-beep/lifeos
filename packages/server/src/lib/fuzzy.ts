import { stemTokens } from '../tools/_habit-match.js';

/**
 * Поиск «по кусочкам букв» (триграммы) — по всей системе (Berik 2026-11-10:
 * «мы друг с памятью»). Голос коверкает слова («Сирик» вместо «Серик»,
 * «отчот» вместо «отчёт») — по корням слов и по смыслу такое не находится,
 * а по общим кусочкам по 3 буквы — находится.
 *
 * Правило безопасности: неточное совпадение — только ЗАПАСНОЙ путь (точного нет),
 * и робот ПЕРЕСПРАШИВАЕТ («ты про Серика?»), а не действует молча: по
 * кусочкам «Ерлан/Ерлен» так же похожи, как «Сирик/Серик».
 *
 * Здесь — JS-версия (как pg_trgm) для задач и коротких списков; в SQL —
 * pg_trgm (`word_similarity`, `<%`), пороги — fuzzyThreshold ниже.
 */

const STOP = new Set([
  'что', 'как', 'где', 'когда', 'это', 'про', 'для', 'мне', 'меня', 'мой', 'моя', 'мои', 'его', 'она', 'они',
  'был', 'была', 'было', 'есть', 'или', 'там', 'тут', 'все', 'всё', 'уже', 'еще', 'ещё', 'знаешь', 'помнишь',
  'скажи', 'расскажи', 'напомни', 'какие', 'какой', 'какая', 'сегодня', 'завтра', 'вчера',
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/** Кусочки по 3 буквы каждого слова (как pg_trgm: слово с отступами «  слово »). */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** Похожесть строк целиком (0..1), как pg_trgm similarity. */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / (A.size + B.size - common);
}

/** Насколько запрос «встречается» в тексте (0..1): доля кусочков запроса, найденных в тексте. */
export function wordSimilarity(query: string, text: string): number {
  const Q = trigrams(query);
  if (Q.size === 0) return 0;
  const T = trigrams(text);
  let common = 0;
  for (const t of Q) if (T.has(t)) common++;
  return common / Q.size;
}

/**
 * Порог «похоже» для слова — по строгой похожести (с целыми словами текста, как
 * pg_trgm strict_word_similarity). Подобран на парах (2026-11-10): опечатки голоса
 * ≥ 0.33 («Сирик/Серик», «инвистор/инвестором», «кридит/кредит»), посторонние ≤ 0.27
 * («пароль/партнёр», «отпуск/отправить»). Ровно так же похожи разные имена
 * «Ерлан/Ерлен» — поэтому неточное совпадение всегда переспрашиваем.
 */
export const FUZZY_WORD_MIN = 0.3;

export function fuzzyThreshold(_word: string): number {
  return FUZZY_WORD_MIN;
}

/** Строгая похожесть слова на текст: лучшая похожесть с ОДНИМ из целых слов текста. */
export function strictWordSimilarity(word: string, text: string): number {
  let best = 0;
  for (const w of normalize(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const s = trigramSimilarity(word, w);
    if (s > best) best = s;
  }
  return best;
}

/** Значимые слова запроса для неточного поиска: основы (без окончаний), ≥4 букв, без служебных, до 5. */
export function fuzzyWords(query: string): string[] {
  const seen = new Set<string>();
  for (const word of normalize(query).split(/[^\p{L}\p{N}]+/u)) {
    if (!word || STOP.has(word)) continue; // служебное — до обрезки окончания
    const raw = stemTokens(word)[0] ?? '';
    if (raw.length < 4 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    seen.add(raw);
    if (seen.size >= 5) break;
  }
  return [...seen];
}

/**
 * Лучшие неточные кандидаты из короткого списка (задачи, имена): похожесть
 * запроса на текст ≥ порога, лучшие первыми. Пусто — ничего похожего.
 */
export function fuzzyRank<T>(query: string, items: T[], text: (t: T) => string, min = 0.5, limit = 4): Array<{ item: T; score: number }> {
  if (!query.trim()) return [];
  return items
    .map((item) => ({ item, score: wordSimilarity(query, text(item)) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Неточный поиск ИМЕНИ: каждое значимое слово запроса (основа) сравнивается с
 * текстом со своим порогом (короткие имена — мягче). Счёт = лучший запас над
 * порогом; ≥ 0 — похоже. «Сирик» → «Серик Ахметов», «Серику» → «Серик».
 */
export function fuzzyNameRank<T>(query: string, items: T[], text: (t: T) => string, limit = 3): Array<{ item: T; score: number }> {
  const words = fuzzyWords(query);
  const qs = words.length > 0 ? words : [normalize(query).trim()].filter((w) => w.length >= 3);
  if (qs.length === 0) return [];
  return items
    .map((item) => {
      const t = text(item);
      const score = Math.max(...qs.map((w) => strictWordSimilarity(w, t) - fuzzyThreshold(w)));
      return { item, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
