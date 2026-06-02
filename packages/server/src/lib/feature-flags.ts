/**
 * v2.0 Feature flags — controls gradual rollout per-user.
 *
 * Used by jarvis-orchestrator in Week 5 to dual-write v2 memory only
 * for opted-in users. Old captureMemory continues for everyone.
 *
 * Env value formats (same for both flags):
 *   "all"                          — enabled for everyone
 *   "" | "none" | "false" | unset  — disabled
 *   "user-{id1},user-{id2}"        — only listed userIds
 *
 * Whitespace around entries and around the whole value is ignored.
 */

function isEnabledForUser(envValue: string | undefined, userId: string): boolean {
  const flag = (envValue ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  if (flag === 'all') return true;
  return flag
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === `user-${userId}`);
}

export function isV2MemoryEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEMORY, userId);
}

export function isV2ProactivityEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_PROACTIVITY, userId);
}

/**
 * v2 Phase B1 — Per-user gate for USER NEST axes feature.
 *
 * Values:
 *   "all" / "true"     → enabled for everyone
 *   "" / "none" / "false" / unset → disabled for everyone
 *   "user-X,user-Y"    → enabled only for those users (comma list)
 */
export function isV2AxesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_AXES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2.0 Week 6 — global cron flag.
 *
 * Crons are global jobs (one sweep affects all users), so no per-user
 * tagging. Enable on Railway with FEATURE_V2_CRON=true once the v2
 * memory dual-write has been running for at least a few days (Week 7
 * after Berik SMOKE passes).
 */
export function isV2CronEnabled(): boolean {
  const flag = (process.env.FEATURE_V2_CRON ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  return flag === 'true' || flag === 'all';
}

/**
 * v2 Phase B2 — Per-user gate for bot Identity Evolution feature.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2IdentityEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_IDENTITY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 Phase B3 — Per-user gate for the cross-session feedback loop.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2FeedbackEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_FEEDBACK;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 Phase B4 — Per-user gate for Hermes composable skills.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2HermesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_HERMES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Reflector v2 — Per-user gate for cross-tier synthesis. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2ReflectorEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_REFLECTOR;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 P2 — Per-user gate for engagement-aware proactivity. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2EngagementEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENGAGEMENT;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * D (spec 2026-06-01): inline-проактивность из длинного текста.
 * Off → байт-в-байт сегодняшнее поведение. Env FEATURE_V2_INLINE_NUDGE
 * в форме "all"/"true" / "none"/unset / "user-X,user-Y".
 */
export function isV2InlineNudgeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_INLINE_NUDGE, userId);
}

/**
 * ОДНА ПАМЯТЬ M2 — Per-user gate для единого писателя (single writer).
 * off → сегодняшняя двойная запись (captureMemory + recordEvent), байт-в-байт.
 * on → ОДИН writeMemory; legacy captureMemory НЕ вызывается.
 * Env FEATURE_V2_WRITE в форме "all" / "none"/"false"/unset / "user-X,user-Y".
 */
export function isV2WriteEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_WRITE, userId);
}
