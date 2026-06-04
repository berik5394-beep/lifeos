export interface CategorySpend {
  category: string;
  amount: number;
}

export interface CategoryImpact {
  /** доля категории от месячной нормы накопления (0..N, может быть >1) */
  share: number;
}

export interface ObligationImpact {
  /** на сколько месяцев накопления долги отодвигают цель */
  monthsDelay: number;
}

/** Доля траты-категории от того, что нужно откладывать в месяц. req<=0 → null. */
export function computeCategoryImpact(
  categorySpend: number,
  requiredMonthly: number,
): CategoryImpact | null {
  if (requiredMonthly <= 0) return null;
  return { share: categorySpend / requiredMonthly };
}

/** На сколько месяцев накопления отодвигают долги. req<=0 → null. */
export function computeObligationImpact(
  totalOwed: number,
  requiredMonthly: number,
): ObligationImpact | null {
  if (requiredMonthly <= 0) return null;
  return { monthsDelay: totalOwed / requiredMonthly };
}

/** Категория с максимальной тратой, или null если список пуст. */
export function pickTopCategory(byCategory: CategorySpend[]): CategorySpend | null {
  if (byCategory.length === 0) return null;
  return byCategory.reduce((max, c) => (c.amount > max.amount ? c : max));
}

/** Человеческая строка из чисел. null если совсем нечего сказать. */
export function describeGoalImpact(
  goalText: string,
  requiredMonthly: number,
  topCat: CategorySpend | null,
  totalOwed: number,
): string | null {
  if (requiredMonthly <= 0) return null;
  const r = (n: number) => Math.round(n);
  const parts: string[] = [];
  const cat = topCat ? computeCategoryImpact(topCat.amount, requiredMonthly) : null;
  if (topCat && cat && cat.share >= 0.1) {
    parts.push(
      `«${topCat.category}» съела ${r(topCat.amount)}₸ = ${r(cat.share * 100)}% ` +
        `от нужного на цель`,
    );
  }
  const obl = totalOwed > 0 ? computeObligationImpact(totalOwed, requiredMonthly) : null;
  if (obl && obl.monthsDelay >= 0.5) {
    parts.push(`долги ${r(totalOwed)}₸ сдвинут цель на ~${r(obl.monthsDelay)} мес`);
  }
  if (parts.length === 0) return null;
  return `🎯 «${goalText}»: нужно ~${r(requiredMonthly)}₸/мес. ` + parts.join('; ') + '.';
}
