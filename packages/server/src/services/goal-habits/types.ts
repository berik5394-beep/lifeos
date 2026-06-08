export interface GoalHabitHealth {
  goalId: string;
  goalText: string;
  linkedHabitCount: number;
  /** дней с последней отметки; null = ни разу не отмечали (#4 честность:
   *  раньше был сентинел 9999 → рендерилось «9999 дн»). */
  daysSinceLastCompletion: number | null;
}

/** «ни разу» (null) ранжируется как худшее. */
function stallRank(d: number | null): number {
  return d === null ? Infinity : d;
}

/** Цели, чьи привязанные привычки буксуют ≥ thresholdDays (или ни разу). */
export function computeStall(rows: GoalHabitHealth[], thresholdDays = 3): GoalHabitHealth[] {
  return rows.filter(
    (r) =>
      r.linkedHabitCount >= 1 &&
      (r.daysSinceLastCompletion === null || r.daysSinceLastCompletion >= thresholdDays),
  );
}

/** Самая буксующая цель (макс daysSince; «ни разу» = худшая) или null. */
export function pickWorstStall(stalling: GoalHabitHealth[]): GoalHabitHealth | null {
  if (stalling.length === 0) return null;
  return [...stalling].sort(
    (a, b) => stallRank(b.daysSinceLastCompletion) - stallRank(a.daysSinceLastCompletion),
  )[0];
}

/** #4 честность — строка-нудж буксующей цели. null → «ещё ни разу» (без
 *  фейковых «9999 дн»), число → «N дн без отметок». */
export function formatStallText(w: GoalHabitHealth): string {
  return w.daysSinceLastCompletion === null
    ? `«${w.goalText}» — привычки к ней ещё ни разу не отмечены`
    : `«${w.goalText}» — ${w.daysSinceLastCompletion} дн без отметок`;
}
