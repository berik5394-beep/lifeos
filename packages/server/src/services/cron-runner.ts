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
  const now = new Date();
  const last = await lastRanAt(jobName, userId);
  if (!shouldRunCron(last, intervalMs, now)) {
    return { ran: false };
  }
  // 2.1 (AUDIT-2026-06): атомарный claim ДО запуска. Раньше check→fn→record
  // был read-then-write — два тика / два инстанса (или наложение деплоя)
  // оба проходили shouldRunCron и оба выполняли fn → дубль (двойной
  // LLM-спенд, гонки на записи). Теперь claim = insert с unique(lockKey);
  // конкуренты ловят P2002 и выходят. lockKey кодирует job:user:период-
  // бакет (единая непустая строка → работает и для global-джоб, userId=null).
  const bucket = Math.floor(now.getTime() / intervalMs);
  const lockKey = `${jobName}:${userId ?? 'global'}:${bucket}`;
  try {
    await prisma.cronJobRun.create({
      data: { jobName, userId: userId ?? null, lockKey },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      // Другой тик/инстанс уже забрал это окно — выходим без запуска.
      return { ran: false };
    }
    console.warn(`[cron-runner] withCronLock(${jobName}) claim failed:`, err);
    return { ran: false };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } catch (err) {
    console.warn(`[cron-runner] withCronLock(${jobName}) fn threw:`, err);
    // Освобождаем claim → окно повторится на следующем тике (сохраняем
    // прежнюю семантику retry-on-failure).
    await prisma.cronJobRun
      .deleteMany({ where: { lockKey } })
      .catch((e) => console.warn(`[cron-runner] claim cleanup failed:`, e));
    return { ran: false };
  }
}
