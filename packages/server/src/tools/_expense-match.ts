import { matchHabit, normalizeHabit } from './_habit-match.js';

export interface ExpenseRef {
  id: string;
  description: string;
  category: string;
  amount: number;
}

/** Что юзер назвал для отката: сумма и/или описание/категория. */
export interface ExpenseQuery {
  amount?: number;
  description?: string;
  category?: string;
}

/**
 * Найти РОВНО ОДИН расход по описанию/категории/сумме. Money-safety:
 * неоднозначность → null (инструмент честно переспросит, не удалит наугад).
 * Текст-фаззи переиспользует рус.-морфологию matchHabit (description как name).
 */
export function matchExpense(
  q: ExpenseQuery,
  items: ExpenseRef[],
): ExpenseRef | null {
  if (items.length === 0) return null;

  // 1. Сумма сужает пул (точное совпадение).
  let pool = items;
  if (typeof q.amount === 'number') {
    pool = items.filter((e) => e.amount === q.amount);
    if (pool.length === 0) return null; // названа сумма, но такой нет
  }

  // 2. Текст (описание → категория) разводит/находит.
  const text = q.description ?? q.category;
  if (text) {
    const nt = normalizeHabit(text);
    // 2a. Точное совпадение по полю: РОВНО одно → берём; >1 (коллизия —
    //     напр. две траты категории food при «удали расход на еду») → null.
    //     Money-safety: matchHabit гасит только fuzzy-ничьи (tier≥2), а
    //     точные ничьи вернули бы произвольную строку → удалили бы не ту.
    if (nt) {
      for (const field of ['description', 'category'] as const) {
        const exact = pool.filter((e) => normalizeHabit(e[field]) === nt);
        if (exact.length === 1) return exact[0];
        if (exact.length > 1) return null;
      }
    }
    // 2b. Нет точного — fuzzy по описанию, затем категории. matchHabit сам
    //     валит fuzzy-ничьи (tier≥2) в null → результат однозначен.
    const byDesc = matchHabit(
      text,
      pool.map((e) => ({ id: e.id, name: e.description })),
    );
    if (byDesc) return pool.find((e) => e.id === byDesc.id) ?? null;
    const byCat = matchHabit(
      text,
      pool.map((e) => ({ id: e.id, name: e.category })),
    );
    if (byCat) return pool.find((e) => e.id === byCat.id) ?? null;
    return null; // текст назван, но не совпал → не угадываем
  }

  // 3. Только сумма: однозначно → расход; неоднозначно → null (safety).
  return pool.length === 1 ? pool[0] : null;
}
