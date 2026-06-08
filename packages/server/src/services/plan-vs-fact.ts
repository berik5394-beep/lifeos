/**
 * Phase 5 R4 — ЕДИНАЯ граница план↔факт (чистое ядро, без БД).
 *
 * До R4 формула «цель отстаёт от темпа года» жила ДВАЖДЫ:
 * get_goal_progress (tool) и proactive-insights (goal_behind правило)
 * считали elapsed/pct/gap независимо → дрейф (класс W4: один
 * gate >=25 с early-year-guard, другой без). Рефлектор (P3.b) стал
 * бы ТРЕТЬИМ. R4 — один авторитет: оба call-site + будущий рефлектор
 * зовут planVsFact (strangler-fig, как isPlannerIntent/insight-core).
 *
 * Чистое и детерминированное: now инъектируется. Никаких догадок —
 * planStale честный boolean (цель менялась ПОЗЖЕ постройки плана).
 */

export interface GoalFact {
  area: string;
  goalText: string;
  /** raw: 0..1 ИЛИ 0..100 (исторический дрейф хранения) — нормализуем. */
  progress: number;
  /** когда цель последний раз менялась (@updatedAt). */
  updatedAt: Date;
  /** newest active planner-child createdAt; null = плана нет. */
  planBuiltAt: Date | null;
  /** кол-во активных planner-недель (0 = плана нет). */
  planWeeks: number;
}

export type GoalStatus = 'отстаёт' | 'в графике' | 'с опережением';

export interface GoalVerdict {
  area: string;
  goalText: string;
  progressPct: number; // нормализованный 0..100
  expectedPct: number; // темп года 0..100
  gap: number; // expected - progress (>0 = отстаёт)
  status: GoalStatus;
  /** elapsed < 15% года — рано судить об отставании (январь).
   *  get_goal_progress это ИГНОРИТ (surface факт всегда);
   *  proactive-insights/рефлектор НЕ эмитят инсайт при tooEarly. */
  tooEarly: boolean;
  /** цель менялась ПОСЛЕ постройки плана ⟺ updatedAt > planBuiltAt
   *  +60с (буфер ms-джиттера одной транзакции). false если плана нет. */
  planStale: boolean;
}

const STALE_BUFFER_MS = 60_000;
const TOO_EARLY = 0.15;
const BEHIND_GAP = 25; // >= => 'отстаёт'
const AHEAD_GAP = -10; // <= => 'с опережением'

/** Доля года, прошедшая на момент now (0..1). */
export function yearElapsedFraction(now: Date): number {
  const y = now.getFullYear();
  const start = new Date(y, 0, 1).getTime();
  const end = new Date(y + 1, 0, 1).getTime();
  return (now.getTime() - start) / (end - start);
}

/** Темп года в процентах (округлённый, как оба легаси call-site). */
export function yearElapsedPct(now: Date): number {
  return Math.round(yearElapsedFraction(now) * 100);
}

/** progress (0..1 или 0..100) → нормализованный процент 0..100. */
function normalizePct(progress: number): number {
  return progress > 1 ? Math.round(progress) : Math.round(progress * 100);
}

/**
 * Единственный расчёт план↔факт. Возвращает темп года + вердикт по
 * каждой цели. Сортировки/срезы/эмиссия — на стороне call-site
 * (get_goal_progress показывает все; insights берёт top-N отстающих).
 */
export function planVsFact(
  goals: GoalFact[],
  now: Date,
): { yearElapsedPct: number; tooEarly: boolean; goals: GoalVerdict[] } {
  const elapsed = yearElapsedFraction(now);
  const expectedPct = Math.round(elapsed * 100);
  const tooEarly = elapsed < TOO_EARLY;

  return {
    yearElapsedPct: expectedPct,
    tooEarly,
    goals: goals.map((g) => {
      const progressPct = normalizePct(g.progress);
      const gap = expectedPct - progressPct;
      const status: GoalStatus =
        gap >= BEHIND_GAP
          ? 'отстаёт'
          : gap <= AHEAD_GAP
            ? 'с опережением'
            : 'в графике';
      const planStale =
        g.planWeeks > 0 &&
        !!g.planBuiltAt &&
        g.updatedAt.getTime() > g.planBuiltAt.getTime() + STALE_BUFFER_MS;
      return {
        area: g.area,
        goalText: g.goalText,
        progressPct,
        expectedPct,
        gap,
        status,
        tooEarly,
        planStale,
      };
    }),
  };
}

/**
 * #2 честность (reflector) — число целей со статусом «отстаёт» по ЭТОЙ ЖЕ
 * единой границе (никакого третьего определения). tooEarly (январь,
 * elapsed<15%) → 0: честное «рано судить», а НЕ фабрикованный «0 отстающих».
 * Заменяет хардкод `goalsBehind: 0` в reflector-v2.
 */
export function countGoalsBehind(goals: GoalFact[], now: Date): number {
  const v = planVsFact(goals, now);
  if (v.tooEarly) return 0;
  return v.goals.filter((g) => g.status === 'отстаёт').length;
}
