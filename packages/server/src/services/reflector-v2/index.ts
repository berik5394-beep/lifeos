/**
 * Reflector v2 — orchestrators. Both run best-effort and write keystones
 * to the EXISTING Insight store (source='reflector_v2'); delivery, TTL,
 * supersede, cooldown, quiet-hours and <=1-push are inherited.
 */

import { prisma } from '../../lib/prisma.js';
import { persistCandidates } from '../insight-store.js';
import type { InsightCandidate } from '../insight-core.js';
import { gatherFacts } from './gather-facts.js';
import { synthesizeKeystone } from './synthesize.js';
import { shouldFireEvent, type Keystone } from './types.js';

export { gatherFacts } from './gather-facts.js';
export { synthesizeKeystone } from './synthesize.js';
export * from './types.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function userStyle(userId: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId }, select: { assistantStyle: true },
    });
    return u?.assistantStyle ?? 'friendly';
  } catch {
    return 'friendly';
  }
}

function toCandidate(k: Keystone, kind: string, scope: string): InsightCandidate {
  return {
    kind,
    scope,
    severity: k.severity,
    message: k.message,
    rationale: k.rationale,
    suggestedAction: k.suggestedAction ?? undefined,
    source: 'reflector_v2',
    ttlDays: 7,
  };
}

/** Weekly deep synthesis. Rolling-7-day gate: at most one weekly keystone
 *  per user per 7 days. Best-effort. */
export async function runWeekly(userId: string, now: Date = new Date()): Promise<{ emitted: boolean }> {
  try {
    const since = new Date(now.getTime() - WEEK_MS);
    const already = await prisma.insight.count({
      where: { userId, source: 'reflector_v2', kind: 'reflector_v2_weekly', createdAt: { gte: since } },
    });
    if (already > 0) return { emitted: false };

    const facts = await gatherFacts(userId, now);
    const keystone = await synthesizeKeystone(facts, await userStyle(userId));
    if (!keystone) return { emitted: false };

    await persistCandidates(
      userId,
      [toCandidate(keystone, 'reflector_v2_weekly', 'reflector_v2:week')],
      now,
    );
    return { emitted: true };
  } catch (err) {
    console.warn('[reflector-v2:weekly] failed:', err);
    return { emitted: false };
  }
}

/** Event-triggered pulse. Fires only when the compound cross-tier signal
 *  crosses the threshold. The Insight R10 cooldown throttles repeats by
 *  kind+scope. Best-effort. */
export async function runEventCheck(userId: string, now: Date = new Date()): Promise<{ emitted: boolean }> {
  try {
    const facts = await gatherFacts(userId, now);
    if (!shouldFireEvent(facts)) return { emitted: false };

    const keystone = await synthesizeKeystone(facts, await userStyle(userId));
    if (!keystone) return { emitted: false };

    await persistCandidates(
      userId,
      [toCandidate(keystone, 'reflector_v2_event', `reflector_v2:event:${keystone.scopeTheme}`)],
      now,
    );
    return { emitted: true };
  } catch (err) {
    console.warn('[reflector-v2:event] failed:', err);
    return { emitted: false };
  }
}
