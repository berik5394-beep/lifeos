/**
 * v2.0 Tier 4 — ProceduralMemory: statistical pattern extraction.
 *
 * Mini-version (Phase A): no ML, no skill creation. Five statistical
 * extractors operate over Episodic events, Entity table, HabitLog,
 * Memory.embedding (Voyage 512d, already stored Week 3), and recent
 * ChatMessage content. All extractors are best-effort and handle
 * empty data gracefully (new user → no patterns, no throws).
 *
 * Pattern mirrors episodic-memory.ts (Week 2):
 *   - Pure helpers (medianInterval, stddev, clampConfidence, etc.)
 *     exported separately for unit tests without DB.
 *   - Async service methods accept userId + return Prisma rows.
 *   - Class implements interface; singleton accessor in separate file.
 *
 * No wiring to jarvis-orchestrator — Week 5 scope.
 */

import { prisma } from '../lib/prisma.js';
import type { Pattern } from '@prisma/client';

// Re-export Prisma type so consumers can import from one place.
export type { Pattern };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ProceduralMemoryStore {
  extractPatterns(userId: string): Promise<Pattern[]>;
  getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]>;
  hasPattern(userId: string, kind: string, payload: object): Promise<Pattern | null>;
  invalidateStale(userId: string, staleDays?: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Compute median interval in DAYS between consecutive sorted timestamps.
 * Returns 0 if < 2 timestamps (no interval to measure).
 * Input may be unsorted — we sort ascending before computing.
 */
export function medianInterval(timestamps: Date[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000);
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[mid - 1] + intervals[mid]) / 2
    : intervals[mid];
}

/**
 * Sample standard deviation (n-1 denominator).
 * Returns 0 for < 2 items.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Map observation count → confidence in [0, 1].
 * Spec: confidence = min(1, observations / 10). Negative → 0.
 */
export function clampConfidence(observations: number): number {
  if (observations <= 0) return 0;
  return Math.min(1, observations / 10);
}

/**
 * Decide whether an interval is "stable enough" to call it a frequency
 * pattern. Stable if median > 0 and sd < threshold * median.
 * Default threshold = 0.5 (spec §6.4 Frequency extractor).
 */
export function isStableInterval(median: number, sd: number, threshold = 0.5): boolean {
  if (median <= 0) return false;
  return sd < threshold * median;
}

// ---------------------------------------------------------------------------
// ProceduralMemory implementation
// ---------------------------------------------------------------------------

export class ProceduralMemory implements ProceduralMemoryStore {
  async extractPatterns(_userId: string): Promise<Pattern[]> {
    throw new Error('extractPatterns not yet implemented — Task B8');
  }

  async getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]> {
    return prisma.pattern.findMany({
      where: {
        userId,
        invalidAt: null,
        ...(opts?.kinds && opts.kinds.length > 0 ? { kind: { in: opts.kinds } } : {}),
        ...(opts?.minConfidence !== undefined
          ? { confidence: { gte: opts.minConfidence } }
          : {}),
      },
      orderBy: [{ confidence: 'desc' }, { lastObservedAt: 'desc' }],
    });
  }

  async hasPattern(
    userId: string,
    kind: string,
    payload: object,
  ): Promise<Pattern | null> {
    const target = JSON.stringify(payload);
    const candidates = await prisma.pattern.findFirst({
      where: { userId, kind, invalidAt: null },
      orderBy: { lastObservedAt: 'desc' },
    });
    // Fast-path: single candidate compared via JSON.stringify of payload.
    // For mini-version we accept O(N) scan if multiple rows share kind —
    // app-level filter avoids leaning on Prisma JSON path queries.
    if (!candidates) return null;
    if (JSON.stringify(candidates.payload) === target) return candidates;

    // Scan others (rare — most users have <10 patterns per kind).
    const all = await prisma.pattern.findMany({
      where: { userId, kind, invalidAt: null },
    });
    for (const row of all) {
      if (JSON.stringify(row.payload) === target) return row;
    }
    return null;
  }

  async invalidateStale(userId: string, staleDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - staleDays * 86_400_000);
    const result = await prisma.pattern.updateMany({
      where: {
        userId,
        invalidAt: null,
        lastObservedAt: { lt: cutoff },
      },
      data: { invalidAt: new Date() },
    });
    return result.count;
  }
}

// ---------------------------------------------------------------------------
// Extractor: frequency
// ---------------------------------------------------------------------------

/**
 * For each Entity with importance >= 5, scan related Memory events from
 * the last 60 days. If median inter-event interval is stable
 * (sd < 50% median), upsert a Pattern{kind:'frequency'}.
 *
 * Best-effort: per-entity errors are caught and logged; we never throw.
 */
export async function extractFrequencyPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const entities = await prisma.entity.findMany({
    where: { userId, importance: { gte: 5 } },
    select: { id: true, name: true },
  });

  if (entities.length === 0) return patterns;

  const cutoff = new Date(Date.now() - 60 * 86_400_000);

  for (const entity of entities) {
    try {
      // Memory.entityRefs is a String[] — use has filter.
      const events = await prisma.memory.findMany({
        where: {
          userId,
          validAt: { gte: cutoff },
          entityRefs: { has: entity.id },
        },
        select: { validAt: true },
        orderBy: { validAt: 'asc' },
      });

      if (events.length < 3) continue; // not enough observations

      const ts = events.map((e) => e.validAt);
      const median = medianInterval(ts);
      const intervals: number[] = [];
      for (let i = 1; i < ts.length; i++) {
        intervals.push((ts[i].getTime() - ts[i - 1].getTime()) / 86_400_000);
      }
      const sd = stddev(intervals);

      if (!isStableInterval(median, sd)) continue;

      const observations = events.length;
      const confidence = clampConfidence(observations);
      const lastObservedAt = ts[ts.length - 1];
      const payload = {
        entityId: entity.id,
        periodDays: Math.round(median * 10) / 10,
        lastObservedAt: lastObservedAt.toISOString(),
      };
      const description = `упоминает ${entity.name} каждые ~${payload.periodDays} дней`;

      // Upsert: look for existing active pattern with same kind+entityId.
      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'frequency', invalidAt: null },
      });

      let row: Pattern;
      if (
        existing &&
        (existing.payload as { entityId?: string })?.entityId === entity.id
      ) {
        row = await prisma.pattern.update({
          where: { id: existing.id },
          data: {
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'frequency',
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] frequency extract failed for entity',
        entity.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// Reference prisma to prevent unused-import lint (will be used in B2+).
void prisma;
