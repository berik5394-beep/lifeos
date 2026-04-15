/**
 * Refresh token cleanup job.
 *
 * Why: /auth/refresh rotates refresh tokens — old ones are marked `revoked=true`
 * but never deleted. On a long-running prod DB this table grows indefinitely,
 * hurting the /auth/refresh findUnique lookup (which has to scan an index
 * that keeps getting larger). Expired-and-revoked tokens have zero value —
 * they can never be used again, they only take up space.
 *
 * Strategy: every hour (configurable), delete tokens that are BOTH:
 *   - revoked = true   (rotated out or explicit logout)
 *   - expiresAt < now - GRACE (30 days by default)
 *
 * The grace window protects against weird clock-skew / audit scenarios
 * where we might want to see recently-revoked tokens. 30 days is plenty.
 *
 * Also deletes any token whose expiresAt < now regardless of revoked flag —
 * those tokens are useless (jwt.verify() will reject them) and cluttering
 * the table.
 *
 * In-process setInterval is sufficient for a single-instance Railway
 * deployment. If LifeOS ever scales to multiple replicas, replace this
 * with a proper cron or a DB-level `pg_cron` job to avoid duplicate work.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REVOKED_GRACE_DAYS = 30;

export function startRefreshTokenCleanup(app: FastifyInstance): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    try {
      const now = new Date();
      const graceCutoff = new Date(now.getTime() - REVOKED_GRACE_DAYS * 24 * 60 * 60 * 1000);

      // Two passes — simpler SQL than an OR, and easier to reason about.
      // 1) Revoked tokens older than grace window.
      const revokedDeleted = await prisma.refreshToken.deleteMany({
        where: {
          revoked: true,
          expiresAt: { lt: graceCutoff },
        },
      });

      // 2) Expired tokens (valid or revoked, all useless now).
      const expiredDeleted = await prisma.refreshToken.deleteMany({
        where: {
          expiresAt: { lt: now },
        },
      });

      const total = revokedDeleted.count + expiredDeleted.count;
      if (total > 0) {
        app.log.info(
          { revoked: revokedDeleted.count, expired: expiredDeleted.count },
          `refresh-token cleanup: removed ${total} stale rows`,
        );
      }
    } catch (err) {
      // Never crash the server on cleanup errors — just log and retry next tick.
      app.log.error({ err }, 'refresh-token cleanup failed');
    }
  };

  // Run once on boot (with a small delay so startup logs aren't noisy),
  // then on interval.
  const bootTimer = setTimeout(() => {
    void run();
  }, 30_000);
  bootTimer.unref?.();

  const interval = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  interval.unref?.();
  return interval;
}
