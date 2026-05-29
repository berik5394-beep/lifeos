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
