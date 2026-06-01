/**
 * v2 P2 — compute a user's recent engagement best-effort from existing rows
 * (Insight.deliveredAt + InsightDismissal + ChatMessage). Never throws; on any
 * failure returns neutral { receptiveness: 0.5, activeHours: [] }.
 */

import { prisma } from '../../lib/prisma.js';
import { localHour } from '../../lib/tz.js';
import { receptivenessScore, activeHourHistogram } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const REPLY_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface Engagement {
  receptiveness: number;
  activeHours: number[]; // 24-slot histogram (empty array if unknown)
}

// Follow-up: getEngagement is called up to 3× per scheduler tick (proactivity
// gate3 + reflector event + deliver). A short per-user TTL memo coalesces those
// intra-tick calls into one DB round-trip. Engagement is slow-moving, so 60s
// staleness is irrelevant; ticks are ~10min apart so cross-tick reads stay fresh.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { value: Engagement; at: number }>();

export async function getEngagement(userId: string, now: Date = new Date()): Promise<Engagement> {
  const nowMs = now.getTime();
  const hit = cache.get(userId);
  if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await computeEngagement(userId, now);
  cache.set(userId, { value, at: nowMs });
  return value;
}

/** For tests only — clear the memo between cases. */
export function _resetEngagementCache(): void {
  cache.clear();
}

async function computeEngagement(userId: string, now: Date): Promise<Engagement> {
  try {
    const since14 = new Date(now.getTime() - 14 * DAY);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { timezone: true },
    });
    const tz = user?.timezone ?? 'UTC';

    const [deliveries, dismissed, userMsgs14, userMsgs30] = await Promise.all([
      prisma.insight.findMany({
        where: { userId, deliveredAt: { gte: since14 } },
        select: { deliveredAt: true },
      }),
      prisma.insightDismissal.count({
        where: { userId, createdAt: { gte: since14 } },
      }),
      prisma.chatMessage.findMany({
        where: { userId, role: 'user', createdAt: { gte: since14 } },
        select: { createdAt: true },
      }),
      prisma.chatMessage.findMany({
        where: { userId, role: 'user', createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
    ]);

    const msgTimes = userMsgs14.map((m) => m.createdAt.getTime());
    let repliedWithin = 0;
    for (const d of deliveries) {
      if (!d.deliveredAt) continue;
      const t = d.deliveredAt.getTime();
      if (msgTimes.some((mt) => mt > t && mt <= t + REPLY_WINDOW_MS)) repliedWithin += 1;
    }

    const receptiveness = receptivenessScore(deliveries.length, dismissed, repliedWithin);
    const activeHours = activeHourHistogram(
      userMsgs30.map((m) => localHour(tz, m.createdAt)),
    );
    return { receptiveness, activeHours };
  } catch (err) {
    console.warn('[engagement:getEngagement] failed:',
      err instanceof Error ? err.message : err);
    return { receptiveness: 0.5, activeHours: [] };
  }
}
