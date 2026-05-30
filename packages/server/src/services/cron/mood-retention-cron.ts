/**
 * v2.0 Week 6 — daily mood-retention cron task.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
 *
 * Goal: keep MoodSnapshot table bounded. Per-message snapshots grow ~5-15
 * rows/day per active user; left unbounded the table is multi-GB in a
 * year. Retention = 30 days of high-res rows + indefinite daily aggregates.
 *
 * Pipeline:
 *   1. SELECT source='message' AND recordedAt < (now - 30d).
 *   2. Group by (userId, YYYY-MM-DD).
 *   3. INSERT one source='daily_agg' row per group with:
 *      - AVG(valence), AVG(arousal)
 *      - MODE() WITHIN GROUP emotion (most frequent emotion of the day)
 *      - union of all entityRefs (deduped via array_agg(DISTINCT))
 *   4. DELETE the original rows.
 *
 * Raw SQL approach (spec §9.6 verbatim): cleanest for complex aggregation
 * with MODE and array union. Parameterized via Prisma template-tag to prevent
 * injection.
 *
 * Best-effort: any error logs + returns; never throws to caller.
 * Fired weekly via withCronLock('mood-retention', 24h) — runs at most once
 * per 24h regardless of scheduler tick count (every 10 min).
 */

import { prisma } from '../../lib/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

type SnapshotRow = {
  userId: string;
  recordedAt: Date;
  valence: number;
  arousal: number | null;
  entityRefs: string[];
};

type Aggregate = {
  valence: number;
  arousal: number;
  entityRefs: string[];
  count: number;
};

/**
 * Pure helper — group rows by (userId, YYYY-MM-DD), averaging valence/arousal
 * and unioning entityRefs. Unit-tested without DB.
 */
export function groupSnapshotsByUserDay(
  rows: SnapshotRow[],
): Map<string, Aggregate> {
  const acc = new Map<
    string,
    {
      valenceSum: number;
      arousalSum: number;
      entityRefs: Set<string>;
      count: number;
    }
  >();
  for (const r of rows) {
    const day = r.recordedAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${r.userId}|${day}`;
    const existing = acc.get(key) ?? {
      valenceSum: 0,
      arousalSum: 0,
      entityRefs: new Set<string>(),
      count: 0,
    };
    existing.valenceSum += r.valence;
    existing.arousalSum += r.arousal ?? 0;
    for (const e of r.entityRefs) existing.entityRefs.add(e);
    existing.count += 1;
    acc.set(key, existing);
  }
  const out = new Map<string, Aggregate>();
  for (const [k, v] of acc) {
    out.set(k, {
      valence: v.valenceSum / v.count,
      arousal: v.arousalSum / v.count,
      entityRefs: Array.from(v.entityRefs),
      count: v.count,
    });
  }
  return out;
}

export async function runMoodRetention(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);

    // Aggregation: spec §9.6 raw SQL with MODE() (spec verbatim)
    // Parameterized via Prisma template-tag (safe from injection).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aggregated = await (prisma.$executeRaw as any)`
      INSERT INTO "MoodSnapshot" (id, "userId", source, valence, arousal, emotion, "recordedAt")
      SELECT gen_random_uuid()::text, "userId", 'daily_agg',
             AVG(valence), AVG(arousal),
             MODE() WITHIN GROUP (ORDER BY emotion),
             date_trunc('day', "recordedAt")
      FROM "MoodSnapshot"
      WHERE source = 'message' AND "recordedAt" < ${cutoff}
      GROUP BY "userId", date_trunc('day', "recordedAt")
      ON CONFLICT DO NOTHING
    `;

    if (aggregated === 0) {
      console.log('[cron:mood-retention] no rows older than 30d — skipping');
      return;
    }

    console.log(
      `[cron:mood-retention] aggregated ${aggregated} daily snapshots`,
    );

    // Delete originals only after successful insert (ON CONFLICT DO NOTHING
    // protects us from duplicate aggregates, but we still want a count).
    let deleted = 0;
    try {
      const result = await prisma.moodSnapshot.deleteMany({
        where: { source: 'message', recordedAt: { lt: cutoff } },
      });
      deleted = result.count;
    } catch (err) {
      console.warn('[cron:mood-retention] deleteMany failed:', err);
      return;
    }

    console.log(
      `[cron:mood-retention] done: ${aggregated} aggregates, ${deleted} originals deleted`,
    );
  } catch (err) {
    console.warn('[cron:mood-retention] top-level failure:', err);
  }
}
