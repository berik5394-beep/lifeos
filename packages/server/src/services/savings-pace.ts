/**
 * Чистое ядро коуча по накоплениям. Без БД/AI — вся математика «темп vs
 * срок» здесь, тестируется раз, зовут три потребителя (рефлектор,
 * реактивный хук, опц. on-demand). Честность by construction: числа из
 * входа (адаптер берёт их из БД), статус детерминирован.
 */
export interface SavingsPaceFacts {
  target: number; // сумма цели (₸); <=0 → no_target
  targetDate: Date; // срок (адаптер подставляет 31 дек если не задан)
  savedSoFar: number; // Σ(Income) − Σ(Expense) с начала года (может быть < 0)
  monthlyPace: number; // текущий темп сбережений/мес (может быть <= 0)
  now: Date;
}

export type SavingsStatus =
  | 'no_target'
  | 'reached'
  | 'stalled'
  | 'behind'
  | 'on_track'
  | 'ahead';

export interface SavingsPace {
  monthsLeft: number;
  remaining: number;
  requiredMonthly: number;
  projected: number;
  paceGap: number;
  shortfall: number;
  progressPct: number;
  status: SavingsStatus;
}

const MS_PER_MONTH = 30.44 * 86_400_000;
const AHEAD_FACTOR = 1.1;

export function computeSavingsPace(f: SavingsPaceFacts): SavingsPace {
  const monthsLeft = Math.max(
    0,
    (f.targetDate.getTime() - f.now.getTime()) / MS_PER_MONTH,
  );
  const remaining = f.target - f.savedSoFar;
  const requiredMonthly =
    monthsLeft > 0 ? Math.max(0, remaining) / monthsLeft : Math.max(0, remaining);
  const projected = f.savedSoFar + f.monthlyPace * monthsLeft;
  const paceGap = requiredMonthly - f.monthlyPace;
  const shortfall = f.target - projected;
  const progressPct = f.target > 0 ? (f.savedSoFar / f.target) * 100 : 0;

  let status: SavingsStatus;
  if (f.target <= 0) status = 'no_target';
  else if (f.savedSoFar >= f.target) status = 'reached';
  else if (monthsLeft <= 0) status = 'behind'; // срок прошёл, не добрал
  else if (f.monthlyPace <= 0) status = 'stalled';
  else if (projected >= f.target * AHEAD_FACTOR) status = 'ahead';
  else if (projected >= f.target) status = 'on_track';
  else status = 'behind';

  return {
    monthsLeft,
    remaining,
    requiredMonthly,
    projected,
    paceGap,
    shortfall,
    progressPct,
    status,
  };
}

/**
 * Выбор фин-цели для коуча среди НЕСКОЛЬКИХ. Раньше брали первую попавшуюся
 * (goals.find) — с несколькими целями это могла быть уже достигнутая, и
 * коуч молчал на той, что отстаёт (живой баг 2026-06-02). Берём НЕ
 * достигнутую (saved < target) с ближайшим сроком (самая срочная незакрытая).
 * Все достигнуты / нет целей → null (коучить нечего). Чистая, тестируется.
 */
export function pickCoachableGoal<
  T extends { target: number; targetDate: Date; saved: number },
>(goals: T[]): T | null {
  const unmet = goals.filter((g) => g.saved < g.target);
  if (unmet.length === 0) return null;
  return unmet
    .slice()
    .sort((a, b) => a.targetDate.getTime() - b.targetDate.getTime())[0];
}
