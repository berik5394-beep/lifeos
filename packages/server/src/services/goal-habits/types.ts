export interface GoalHabitHealth {
  goalId: string;
  goalText: string;
  linkedHabitCount: number;
  daysSinceLastCompletion: number; // 9999 если ни разу не отмечали
}

/** Цели, чьи привязанные привычки буксуют ≥ thresholdDays. */
export function computeStall(rows: GoalHabitHealth[], thresholdDays = 3): GoalHabitHealth[] {
  return rows.filter(
    (r) => r.linkedHabitCount >= 1 && r.daysSinceLastCompletion >= thresholdDays,
  );
}

/** Самая буксующая цель (макс daysSince) или null. */
export function pickWorstStall(stalling: GoalHabitHealth[]): GoalHabitHealth | null {
  if (stalling.length === 0) return null;
  return [...stalling].sort(
    (a, b) => b.daysSinceLastCompletion - a.daysSinceLastCompletion,
  )[0];
}
