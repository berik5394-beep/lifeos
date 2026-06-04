export type RunwayStatus =
  | 'no_data'
  | 'cash_positive'
  | 'underwater'
  | 'critical'
  | 'short'
  | 'healthy';

export interface RunwayInput {
  cashOnHand: number; // накопленный net (доход − расход за всё время)
  monthlyIncome: number;
  monthlyBurn: number;
}

export interface RunwayResult {
  netBurnRate: number; // monthlyBurn − monthlyIncome (>0 = чистый отток)
  runwayMonths: number | null; // null если не считаем (no_data/cash_positive)
  status: RunwayStatus;
}

/** Чистая формула runway. Деления на ноль нет (netBurnRate>0 гарантирован). */
export function computeRunway(input: RunwayInput): RunwayResult {
  const { cashOnHand, monthlyIncome, monthlyBurn } = input;
  const netBurnRate = monthlyBurn - monthlyIncome;

  if (monthlyBurn <= 0 && monthlyIncome <= 0) {
    return { netBurnRate, runwayMonths: null, status: 'no_data' };
  }
  if (netBurnRate <= 0) {
    return { netBurnRate, runwayMonths: null, status: 'cash_positive' };
  }
  if (cashOnHand <= 0) {
    return { netBurnRate, runwayMonths: 0, status: 'underwater' };
  }
  const runwayMonths = cashOnHand / netBurnRate;
  const status: RunwayStatus =
    runwayMonths < 1 ? 'critical' : runwayMonths < 3 ? 'short' : 'healthy';
  return { netBurnRate, runwayMonths, status };
}

/** Человеческая строка. null для healthy/cash_positive/no_data (молчим). */
/** Якорный кэш: баланс со слов юзера минус траты после снапшота плюс доходы после. */
export function computeAnchoredCash(input: {
  balance: number;
  expensesSince: number;
  incomesSince: number;
}): number {
  return input.balance - input.expensesSince + input.incomesSince;
}

/**
 * Человеческая строка. Без якоря — null для healthy/cash_positive/no_data
 * (молчим, проактивный «ноет когда мало»). С якорем (юзер сам назвал баланс)
 * — число для любого статуса кроме no_data; healthy/cash_positive позитивно.
 */
export function describeRunway(
  r: RunwayResult,
  cashOnHand: number,
  opts: { hasAnchor?: boolean; monthlyIncome?: number } = {},
): string | null {
  const round = (n: number) => Math.round(n);
  const tail =
    opts.hasAnchor && (opts.monthlyIncome ?? 0) <= 0
      ? ' — считаю без учёта дохода, записывай зарплату → посчитаю точнее'
      : '';
  if (r.status === 'no_data') return null;
  if (r.status === 'underwater') {
    return (
      '💸 По записям расходы давно обгоняют доходы (накоплен минус). Стоит сократить траты.' +
      tail
    );
  }
  if (r.status === 'critical' || r.status === 'short') {
    const months = r.runwayMonths == null ? 0 : Math.round(r.runwayMonths * 10) / 10;
    return (
      `💸 По записям у тебя ~${round(cashOnHand)}₸, чистый расход ~${round(r.netBurnRate)}₸/мес → ` +
      `денег хватит на ~${months} мес.` +
      tail
    );
  }
  // healthy / cash_positive — молчим, ЕСЛИ нет якоря-снапшота.
  if (!opts.hasAnchor) return null;
  if (r.status === 'cash_positive') {
    return (
      `✅ По записям расходы не превышают доход — баланс ~${round(cashOnHand)}₸ держится, хватит надолго.` +
      tail
    );
  }
  // healthy
  const months = r.runwayMonths == null ? 0 : Math.round(r.runwayMonths * 10) / 10;
  return (
    `✅ По записям у тебя ~${round(cashOnHand)}₸, при текущем темпе хватит на ~${months} мес — спокойно.` +
    tail
  );
}
