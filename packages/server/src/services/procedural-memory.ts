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
    _userId: string,
    _opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]> {
    throw new Error('getActivePatterns not yet implemented — Task B2');
  }

  async hasPattern(
    _userId: string,
    _kind: string,
    _payload: object,
  ): Promise<Pattern | null> {
    throw new Error('hasPattern not yet implemented — Task B2');
  }

  async invalidateStale(_userId: string, _staleDays = 30): Promise<number> {
    throw new Error('invalidateStale not yet implemented — Task B2');
  }
}

// Reference prisma to prevent unused-import lint (will be used in B2+).
void prisma;
