/**
 * Cyrillic-safe pattern helpers.
 *
 * ПРОБЛЕМА: JS regex `\b` — ASCII-word-boundary. Между кириллицей и
 * пробелом/началом строки граница НЕ срабатывает по-ожидаемому
 * (кириллица для `\b` — это `\W`, а не `\w`). Прецеденты: classifyGoal
 * (Phase 5), safety-classifier C1.1b, emotional-classifier C3.1 —
 * каждый раз recall ловил, мы убирали `\b`. 3-й рецидив за фазу.
 *
 * РЕШЕНИЕ: единый helper + структурный lint
 * (no-bare-b-cyrillic.test.ts), запрещающий `\b` рядом с кириллицей
 * в любом regex-литерале в исходниках. Не помешать никогда — лучшая
 * страховка от 4-го рецидива.
 *
 * УПОТРЕБЛЕНИЕ: для МНОГОСЛОВНЫХ фраз обычно достаточно phrase-
 * специфичности (без границ слова — два слова с пробелом уже
 * однозначны). Для одиночных корней — wrapCyrillicWord ниже.
 */

/** Cyrillic-safe «не-буква до» и «не-буква после» — заменяют `\b`. */
const NOT_LETTER = '(?:^|[^\\p{L}])';
const NOT_LETTER_AHEAD = '(?=$|[^\\p{L}])';

/**
 * Обёртывает строковый паттерн cyrillic-safe границами и возвращает
 * RegExp с флагом `u` (Unicode property escapes требуют `u`).
 * Использовать когда нужна именно «целое слово» семантика для
 * одиночного корня (где multi-word специфичности нет).
 */
export function cyrillicWord(pattern: string, flags = 'iu'): RegExp {
  const f = flags.includes('u') ? flags : flags + 'u';
  return new RegExp(`${NOT_LETTER}${pattern}${NOT_LETTER_AHEAD}`, f);
}

/**
 * Проверка: любая из фраз присутствует в тексте. Phrases — массив
 * RegExp или строк (строки матчатся как substring, без \b — phrase-
 * специфичность держит precision). Главное: не используем \b с
 * кириллицей внутри.
 */
export function containsAny(text: string, phrases: Array<RegExp | string>): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  for (const p of phrases) {
    if (typeof p === 'string') {
      if (t.includes(p.toLowerCase())) return true;
    } else {
      if (p.test(text)) return true;
    }
  }
  return false;
}
