/**
 * v2.0 Week 6 — weekly pattern-extraction cron task.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
 *
 * Goal: refresh procedural patterns (frequency, time-of-day, commitments,
 * streak-break) so the Week-5 proactivity engine has fresh detector input.
 *
 * Pipeline:
 *   1. SELECT every user with at least one ChatMessage in the last 7 days.
 *   2. For each (sequentially): getProceduralMemory().extractPatterns(userId).
 *
 * Sequential because extractPatterns hits Claude — parallel would burn the
 * rate limit. Per-user try/catch keeps the sweep alive when one user's
 * extraction crashes (bad Claude response, Voyage timeout, etc).
 *
 * Fired weekly via withCronLock('pattern-extraction', 7d).
 */

import { prisma } from '../../lib/prisma.js';
import { getProceduralMemory } from '../procedural-memory.singleton.js';
import { isV2ForgetEnabled } from '../../lib/feature-flags.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * F4b — порог устаревания паттернов. Щедрые 60 дней, чтобы НЕ ретайрить
 * редкие-но-живые паттерны (напр. месячные «платит аренду»).
 */
const STALE_PATTERN_DAYS = 60;

/**
 * F4b — ретайр устаревших паттернов (lastObservedAt старше STALE_PATTERN_DAYS)
 * за флагом FEATURE_V2_FORGET. Включает уже построенный, но мёртвый
 * invalidateStale. Обратимо: ре-наблюдение в extractPatterns бампает
 * lastObservedAt → паттерн снова active (getActivePatterns чтит invalidAt).
 * Best-effort: сбой логируется, sweep продолжается. off → return 0 (байт-идентично).
 */
export async function maybeRetireStale(
  procedural: { invalidateStale(userId: string, staleDays?: number): Promise<number> },
  userId: string,
): Promise<number> {
  if (!isV2ForgetEnabled(userId)) return 0;
  try {
    const retired = await procedural.invalidateStale(userId, STALE_PATTERN_DAYS);
    if (retired > 0) {
      console.log(`[cron:pattern-extraction] user=${userId} → retired ${retired} stale patterns`);
    }
    return retired;
  } catch (err) {
    console.warn(
      `[cron:pattern-extraction] user=${userId} invalidateStale failed:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

type UserWithLastMessage = {
  id: string;
  lastMessageAt: Date | null;
};

/**
 * Pure helper — filter users to those with at least one message in the last
 * `sinceDays` days. Unit-tested without DB.
 */
export function pickActiveUsers(
  users: UserWithLastMessage[],
  sinceDays = 7,
  now: Date = new Date(),
): UserWithLastMessage[] {
  const cutoff = now.getTime() - sinceDays * DAY_MS;
  return users.filter(
    (u) => u.lastMessageAt !== null && u.lastMessageAt.getTime() >= cutoff,
  );
}

export async function runPatternExtraction(): Promise<void> {
  try {
    // Join: every User + their most recent ChatMessage timestamp.
    // Prisma 6 doesn't have a clean "user with relation max" — we just
    // hand-roll the lookup. Two queries, both indexed.
    const users = await prisma.user.findMany({ select: { id: true } });
    if (users.length === 0) {
      console.log('[cron:pattern-extraction] no users — skipping');
      return;
    }

    const userIds = users.map((u) => u.id);
    const lastMessages = await prisma.chatMessage.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true },
    });
    const lastByUser = new Map<string, Date | null>();
    for (const u of userIds) lastByUser.set(u, null);
    for (const m of lastMessages) {
      lastByUser.set(m.userId, m._max.createdAt ?? null);
    }

    const enriched: UserWithLastMessage[] = users.map((u) => ({
      id: u.id,
      lastMessageAt: lastByUser.get(u.id) ?? null,
    }));

    const active = pickActiveUsers(enriched, 7);
    if (active.length === 0) {
      console.log(
        '[cron:pattern-extraction] no users active in last 7d — skipping',
      );
      return;
    }

    console.log(
      `[cron:pattern-extraction] starting sweep for ${active.length} active users`,
    );

    const procedural = getProceduralMemory();
    let ok = 0;
    let failed = 0;
    for (const u of active) {
      try {
        const patterns = await procedural.extractPatterns(u.id);
        ok++;
        console.log(
          `[cron:pattern-extraction] user=${u.id} → ${patterns.length} patterns`,
        );
      } catch (err) {
        failed++;
        console.warn(
          `[cron:pattern-extraction] user=${u.id} extractPatterns failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      // F4b: ретайр устаревших паттернов — независимо от исхода extractPatterns,
      // за флагом (off=байт-идентично: maybeRetireStale возвращает 0, ничего не пишет).
      await maybeRetireStale(procedural, u.id);
    }
    console.log(
      `[cron:pattern-extraction] done: ${ok} ok, ${failed} failed, ${active.length} total`,
    );
  } catch (err) {
    console.warn('[cron:pattern-extraction] top-level failure:', err);
  }
}
