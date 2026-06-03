import { computeSavingsPace, type SavingsStatus } from './savings-pace.js';

const MS_PER_MONTH = 30.44 * 86_400_000;
const MIN_ELAPSED_MONTHS = 0.5; // раньше — темп не считаем (мало данных)
const FIN_RE = /financ|финанс/i;

/** Денежная цель (ими владеет savings-coach) → исключаем из пейсинга. */
export function isMoneyGoal(area: string, target: number | null): boolean {
  return FIN_RE.test(area) && target != null;
}

export interface GoalPace {
  status: SavingsStatus;
  requiredMonthly: number;
  currentMonthly: number;
  done: number;
  monthsLeft: number;
  monthsElapsed: number;
}

/** Дек 31 указанного года, 23:59 UTC (грубый дедлайн по умолчанию). */
function dec31(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 0));
}

/**
 * Пейсинг измеримой цели поверх computeSavingsPace. done = progress%/100*target;
 * темп = done / прошедшие месяцы (с createdAt); дедлайн = targetDate ?? 31 дек.
 */
export function computeGoalPace(
  g: { target: number; targetDate: Date | null; progress: number; createdAt: Date },
  now: Date,
): GoalPace {
  const target = g.target > 0 ? g.target : 0;
  const done = (g.progress / 100) * target;
  const targetDate = g.targetDate ?? dec31(now.getUTCFullYear());
  const monthsElapsed = Math.max(0, (now.getTime() - g.createdAt.getTime()) / MS_PER_MONTH);
  const currentMonthly = monthsElapsed >= MIN_ELAPSED_MONTHS ? done / monthsElapsed : 0;
  const pace = computeSavingsPace({
    target,
    targetDate,
    savedSoFar: done,
    monthlyPace: currentMonthly,
    now,
  });
  return {
    status: pace.status,
    requiredMonthly: pace.requiredMonthly,
    currentMonthly,
    done,
    monthsLeft: pace.monthsLeft,
    monthsElapsed,
  };
}

/**
 * Человеческая строка. null если успеваешь/достиг/нет цели. Иначе (behind/
 * stalled): «нужно ~X/мес»; «твой темп» — только если данных достаточно
 * (monthsElapsed≥MIN).
 */
export function describeGoalPace(goalText: string, p: GoalPace, target: number): string | null {
  if (p.status === 'reached' || p.status === 'on_track' || p.status === 'ahead' || p.status === 'no_target') {
    return null;
  }
  const r = (n: number) => Math.round(n);
  const tempo =
    p.monthsElapsed >= MIN_ELAPSED_MONTHS ? ` твой темп ~${r(p.currentMonthly)}/мес.` : '';
  return (
    `📚 «${goalText}»: ${r(p.done)} из ${target}, осталось ~${r(p.monthsLeft)} мес — ` +
    `нужно ~${r(p.requiredMonthly)}/мес.${tempo} Поднажми.`
  );
}
