import { describe, it, expect } from 'vitest';
import {
  medianInterval,
  stddev,
  clampConfidence,
  isStableInterval,
} from './procedural-memory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// medianInterval
// ---------------------------------------------------------------------------

describe('medianInterval — pure helper', () => {
  it('returns 0 for empty list', () => {
    expect(medianInterval([])).toBe(0);
  });

  it('returns 0 for single timestamp', () => {
    expect(medianInterval([new Date('2026-05-01')])).toBe(0);
  });

  it('returns median day-delta for evenly spaced timestamps', () => {
    const ts = [
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z'),
      new Date('2026-05-07T00:00:00Z'),
    ];
    expect(medianInterval(ts)).toBe(3);
  });

  it('returns median (not mean) for unevenly spaced timestamps', () => {
    const ts = [
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-03T00:00:00Z'), // +2
      new Date('2026-05-06T00:00:00Z'), // +3
      new Date('2026-05-20T00:00:00Z'), // +14 (outlier)
    ];
    // intervals: [2,3,14] → median=3 (mean would be 6.33)
    expect(medianInterval(ts)).toBe(3);
  });

  it('handles unsorted input (sorts ascending first)', () => {
    const ts = [
      new Date('2026-05-07T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z'),
    ];
    expect(medianInterval(ts)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// stddev
// ---------------------------------------------------------------------------

describe('stddev — pure helper', () => {
  it('returns 0 for empty', () => {
    expect(stddev([])).toBe(0);
  });

  it('returns 0 for single value', () => {
    expect(stddev([5])).toBe(0);
  });

  it('returns 0 for all-equal values', () => {
    expect(stddev([3, 3, 3, 3])).toBe(0);
  });

  it('computes sample stddev (n-1 denominator)', () => {
    // values [2,4,4,4,5,5,7,9] → sample sd ≈ 2.138
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeGreaterThan(2.1);
    expect(result).toBeLessThan(2.2);
  });
});

// ---------------------------------------------------------------------------
// clampConfidence
// ---------------------------------------------------------------------------

describe('clampConfidence — pure helper', () => {
  it('returns 0 for 0 observations', () => {
    expect(clampConfidence(0)).toBe(0);
  });

  it('returns 0.5 for 5 observations', () => {
    expect(clampConfidence(5)).toBe(0.5);
  });

  it('caps at 1.0 for 10+ observations', () => {
    expect(clampConfidence(10)).toBe(1);
    expect(clampConfidence(100)).toBe(1);
  });

  it('clamps negative observations to 0', () => {
    expect(clampConfidence(-3)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isStableInterval
// ---------------------------------------------------------------------------

describe('isStableInterval — pure helper', () => {
  it('returns false if median is 0', () => {
    expect(isStableInterval(0, 0)).toBe(false);
  });

  it('returns true when sd < 50% of median (default threshold)', () => {
    expect(isStableInterval(10, 4)).toBe(true);
  });

  it('returns false when sd >= 50% of median', () => {
    expect(isStableInterval(10, 5)).toBe(false);
    expect(isStableInterval(10, 8)).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(isStableInterval(10, 2, 0.3)).toBe(true);  // 2 < 3
    expect(isStableInterval(10, 4, 0.3)).toBe(false); // 4 >= 3
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  join(process.cwd(), 'src/services/procedural-memory.ts'),
  'utf-8',
);

describe('procedural-memory.ts structural — skeleton + pure helpers', () => {
  it('exports ProceduralMemory class', () => {
    expect(SRC).toMatch(/export class ProceduralMemory/);
  });

  it('exports ProceduralMemory interface (or implements)', () => {
    expect(SRC).toMatch(/implements ProceduralMemoryStore|export interface ProceduralMemory/);
  });

  it('exports medianInterval pure helper', () => {
    expect(SRC).toMatch(/export function medianInterval/);
  });

  it('exports stddev pure helper', () => {
    expect(SRC).toMatch(/export function stddev/);
  });

  it('exports clampConfidence pure helper', () => {
    expect(SRC).toMatch(/export function clampConfidence/);
  });

  it('exports isStableInterval pure helper', () => {
    expect(SRC).toMatch(/export function isStableInterval/);
  });

  it('re-exports Pattern type from @prisma/client', () => {
    expect(SRC).toMatch(/export type \{[^}]*Pattern[^}]*\}/);
  });

  it('class declares extractPatterns method (will throw placeholder)', () => {
    expect(SRC).toMatch(/async extractPatterns\s*\(/);
  });

  it('class declares getActivePatterns method', () => {
    expect(SRC).toMatch(/async getActivePatterns\s*\(/);
  });

  it('class declares hasPattern method', () => {
    expect(SRC).toMatch(/async hasPattern\s*\(/);
  });

  it('class declares invalidateStale method', () => {
    expect(SRC).toMatch(/async invalidateStale\s*\(/);
  });
});

describe('procedural-memory.ts structural — getActivePatterns / hasPattern / invalidateStale', () => {
  it('getActivePatterns filters invalidAt IS NULL (active only)', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt');
    expect(body).toContain('null');
  });

  it('getActivePatterns filters by kinds when provided', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('kinds');
    expect(body).toContain('in:');
  });

  it('getActivePatterns filters by minConfidence when provided', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('minConfidence');
    expect(body).toContain('gte:');
  });

  it('getActivePatterns orders by confidence DESC', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/orderBy[\s\S]*?confidence[\s\S]*?desc/);
  });

  it('hasPattern uses prisma.pattern.findFirst', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('prisma.pattern.findFirst');
  });

  it('hasPattern filters invalidAt IS NULL', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt');
  });

  it('hasPattern compares payload via JSON.stringify equality', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('JSON.stringify');
  });

  it('invalidateStale uses updateMany and sets invalidAt = now', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('prisma.pattern.updateMany');
    expect(body).toContain('invalidAt');
  });

  it('invalidateStale defaults staleDays to 30', () => {
    expect(SRC).toMatch(/staleDays\s*=\s*30/);
  });

  it('invalidateStale filters lastObservedAt < cutoff', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('lastObservedAt');
    expect(body).toContain('lt:');
  });

  it('invalidateStale returns count (number)', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('.count');
  });
});
