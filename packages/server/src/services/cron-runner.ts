/**
 * v2.0 Week 6 — cron idempotency primitive.
 *
 * Backs the two Week-6 cron tasks (mood-retention-cron, pattern-
 * extraction-cron). Single source of truth for "did this job run
 * recently?". Storage is the new CronJobRun Prisma model (Week 6 A1);
 * decision is the pure helper shouldRunCron.
 *
 * Semantics:
 *   - withCronLock(jobName, intervalMs, userId, fn) reads lastRanAt;
 *     if shouldRunCron → executes fn; on success records the run.
 *   - On fn throw → does NOT record → next scheduler tick retries.
 *   - Tolerates clock skew: future lastRanAt is treated as "ran very
 *     recently" (returns false) — never runs twice due to NTP jitter.
 *
 * userId === null = global job (e.g. mood-retention sweeps all users in
 * one pass). userId set = per-user job (future: per-user pattern
 * extraction with finer throttle).
 */

import { prisma } from '../lib/prisma.js';

export function shouldRunCron(
  lastRanAt: Date | null,
  intervalMs: number,
  now: Date = new Date(),
): boolean {
  if (lastRanAt === null) return true;
  const delta = now.getTime() - lastRanAt.getTime();
  // Defensive: future lastRanAt means clock went backwards (NTP correction,
  // VM time-warp, etc). Treat as "ran recently" — fail-closed.
  if (delta < 0) return false;
  return delta >= intervalMs;
}

export async function lastRanAt(
  jobName: string,
  userId: string | null = null,
): Promise<Date | null> {
  try {
    const row = await prisma.cronJobRun.findFirst({
      where: { jobName, userId: userId ?? null },
      orderBy: { ranAt: 'desc' },
      select: { ranAt: true },
    });
    return row?.ranAt ?? null;
  } catch (err) {
    console.warn(`[cron-runner] lastRanAt(${jobName}) failed:`, err);
    return null;
  }
}

export async function recordRun(
  jobName: string,
  userId: string | null = null,
): Promise<void> {
  try {
    await prisma.cronJobRun.create({
      data: { jobName, userId: userId ?? null },
    });
  } catch (err) {
    // Recording failure is non-fatal — worst case the job runs again
    // next tick. Log loudly so we notice if it becomes systematic.
    console.warn(`[cron-runner] recordRun(${jobName}) failed:`, err);
  }
}

export async function withCronLock<T>(
  jobName: string,
  intervalMs: number,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  const last = await lastRanAt(jobName, userId);
  if (!shouldRunCron(last, intervalMs)) {
    return { ran: false };
  }
  try {
    const result = await fn();
    // Record only on success — failures retry next tick automatically.
    await recordRun(jobName, userId);
    return { ran: true, result };
  } catch (err) {
    console.warn(`[cron-runner] withCronLock(${jobName}) fn threw:`, err);
    // Do NOT recordRun → next tick re-attempts.
    return { ran: false };
  }
}
