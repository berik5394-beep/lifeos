/** Экспоненциальная свежесть: 1.0 сейчас → 0.5 через halflifeDays → ~0 на больших сроках. */
export function recencyFactor(daysSince: number, halflifeDays: number): number {
  const d = Math.max(0, daysSince);
  return Math.pow(2, -d / halflifeDays);
}

/** Период полураспада значимости сущности (дни). */
export const ENTITY_HALFLIFE_DAYS = 45;

/** Эффективная значимость сущности для показа: importance × свежесть(lastSeenAt).
 *  null lastSeenAt → трактуем как древнее (10 лет). */
export function entityDecayScore(
  importance: number,
  lastSeenAt: Date | null,
  now: Date,
): number {
  const days = lastSeenAt ? (now.getTime() - lastSeenAt.getTime()) / 86_400_000 : 3650;
  return importance * recencyFactor(days, ENTITY_HALFLIFE_DAYS);
}
