import { describe, it, expect } from 'vitest';
import {
  medianInterval,
  stddev,
  clampConfidence,
  isStableInterval,
  hourHistogramWindow,
  cosineSimilarity,
  greedyCluster,
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

describe('procedural-memory.ts structural — extractFrequencyPatterns', () => {
  it('exports extractFrequencyPatterns as standalone async function', () => {
    expect(SRC).toMatch(/export async function extractFrequencyPatterns/);
  });

  it('filters entities by importance >= 5', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('importance');
    expect(body).toContain('gte:');
    expect(body).toContain('5');
  });

  it('queries Memory.entityRefs over last 60 days', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('entityRefs');
    expect(body).toContain('60');
  });

  it('uses medianInterval + isStableInterval helpers', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('medianInterval(');
    expect(body).toContain('isStableInterval(');
  });

  it('uses clampConfidence helper', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('clampConfidence(');
  });

  it('creates Pattern with kind=frequency', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'frequency'");
  });

  it('handles empty data (no entities) without throwing', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/return \[\]|patterns/);
  });

  it('wraps per-entity work in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

// ---------------------------------------------------------------------------
// hourHistogramWindow
// ---------------------------------------------------------------------------

describe('hourHistogramWindow — pure helper', () => {
  it('returns peakHour=null when input empty', () => {
    expect(hourHistogramWindow([])).toEqual({ peakHour: null, pct: 0 });
  });

  it('finds peak hour for clustered hours', () => {
    // 10 logs at 7am, 2 at 8am, 1 at 9am → peak=7, window [5..9] = 13/13 = 1.0
    const hours = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 9];
    const result = hourHistogramWindow(hours);
    expect(result.peakHour).toBe(7);
    expect(result.pct).toBeCloseTo(1.0, 2);
  });

  it('handles bimodal distribution by choosing first peak with most ±2h mass', () => {
    // 5 at 7am, 5 at 19pm → both equally peaks; we choose smaller hour (deterministic)
    const hours = [7, 7, 7, 7, 7, 19, 19, 19, 19, 19];
    const result = hourHistogramWindow(hours);
    expect([7, 19]).toContain(result.peakHour);
    expect(result.pct).toBeCloseTo(0.5, 2);
  });

  it('wraps window around midnight (e.g. 23, 0, 1 cluster)', () => {
    const hours = [23, 23, 23, 0, 0, 0, 1, 1, 1];
    const result = hourHistogramWindow(hours);
    // Any of 23/0/1 acceptable as peak; window ±2 covers all 9
    expect(result.pct).toBeCloseTo(1.0, 2);
  });

  it('respects custom windowSize', () => {
    const hours = [7, 7, 7, 12, 12, 12];
    // windowSize=1 → peak=7, window [6,7,8] = 3/6 = 0.5
    expect(hourHistogramWindow(hours, 1).pct).toBeCloseTo(0.5, 2);
  });
});

describe('procedural-memory.ts structural — extractTimeOfDayPatterns', () => {
  it('exports extractTimeOfDayPatterns', () => {
    expect(SRC).toMatch(/export async function extractTimeOfDayPatterns/);
  });

  it('exports hourHistogramWindow helper', () => {
    expect(SRC).toMatch(/export function hourHistogramWindow/);
  });

  it('queries habits with at least 14 logs (count or threshold check)', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('14');
  });

  it('uses hourHistogramWindow', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('hourHistogramWindow(');
  });

  it('checks pct >= 0.7 threshold (spec §6.4)', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('0.7');
  });

  it('creates Pattern with kind=time_of_day', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'time_of_day'");
  });

  it('handles no habits gracefully (returns [])', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/return patterns|return \[\]/);
  });

  it('wraps per-habit work in try/catch', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity — pure helper', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 if either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('returns 0 if lengths differ', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('handles normalized 3D vectors correctly', () => {
    expect(cosineSimilarity([3, 4, 0], [3, 4, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([3, 4, 0], [4, 3, 0])).toBeCloseTo(0.96, 2);
  });
});

// ---------------------------------------------------------------------------
// greedyCluster
// ---------------------------------------------------------------------------

describe('greedyCluster — pure helper', () => {
  it('returns no clusters for empty input', () => {
    expect(greedyCluster([])).toEqual([]);
  });

  it('places a single vector into one cluster', () => {
    const clusters = greedyCluster([[1, 0, 0]]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIndexes).toEqual([0]);
  });

  it('groups similar vectors into one cluster (cos >= 0.75)', () => {
    const clusters = greedyCluster([
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0.95, 0.05, 0],
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIndexes).toEqual([0, 1, 2]);
  });

  it('separates dissimilar vectors into different clusters', () => {
    const clusters = greedyCluster([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(clusters).toHaveLength(3);
  });

  it('respects custom threshold', () => {
    const a = [1, 0];
    const b = [0.7071, 0.7071];
    expect(greedyCluster([a, b], 0.6)).toHaveLength(1);
    expect(greedyCluster([a, b], 0.8)).toHaveLength(2);
  });

  it('updates centroid as running mean', () => {
    const clusters = greedyCluster([
      [1, 0],
      [1, 0],
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].centroid[0]).toBeCloseTo(1, 5);
    expect(clusters[0].centroid[1]).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// extractRecurringTopicPatterns structural tests
// ---------------------------------------------------------------------------

describe('procedural-memory.ts structural — extractRecurringTopicPatterns', () => {
  it('exports extractRecurringTopicPatterns', () => {
    expect(SRC).toMatch(/export async function extractRecurringTopicPatterns/);
  });

  it('exports cosineSimilarity helper', () => {
    expect(SRC).toMatch(/export function cosineSimilarity/);
  });

  it('exports greedyCluster helper', () => {
    expect(SRC).toMatch(/export function greedyCluster/);
  });

  it('filters entities by importance >= 7', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('importance');
    expect(body).toContain('7');
  });

  it('uses $queryRawUnsafe to read embeddings (pgvector Unsupported)', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('$queryRawUnsafe');
    expect(body).toContain('embedding');
  });

  it('calls greedyCluster with cosine threshold ~0.75', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('greedyCluster(');
    expect(body).toContain('0.75');
  });

  it('requires cluster size >= 3 (spec §6.4)', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('>= 3');
  });

  it('creates Pattern with kind=recurring_topic', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain("'recurring_topic'");
  });

  it('wraps per-entity work in try/catch', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

// ---------------------------------------------------------------------------
// matchesCommitmentPhrase — pure helper
// ---------------------------------------------------------------------------

describe('matchesCommitmentPhrase — pure helper', async () => {
  const { matchesCommitmentPhrase } = await import('./procedural-memory.js');

  it('returns true for "обещаю"', () => {
    expect(matchesCommitmentPhrase('обещаю прочитать книгу')).toBe(true);
  });

  it('returns true for "буду"', () => {
    expect(matchesCommitmentPhrase('буду ходить в зал')).toBe(true);
  });

  it('returns true for "с понедельника"', () => {
    expect(matchesCommitmentPhrase('с понедельника бросаю курить')).toBe(true);
  });

  it('returns true for "решил"', () => {
    expect(matchesCommitmentPhrase('решил пойти на йогу')).toBe(true);
  });

  it('returns false for random text', () => {
    expect(matchesCommitmentPhrase('погода сегодня хорошая')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(matchesCommitmentPhrase('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseCommitmentResponse — pure helper
// ---------------------------------------------------------------------------

describe('parseCommitmentResponse — pure helper', async () => {
  const { parseCommitmentResponse } = await import('./procedural-memory.js');

  it('parses valid JSON with what + dueAt', () => {
    const raw = JSON.stringify({ what: 'читать 30 мин в день', dueAt: '2026-06-01T00:00:00Z' });
    const result = parseCommitmentResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.what).toBe('читать 30 мин в день');
    expect(result!.dueAt).toBeInstanceOf(Date);
  });

  it('parses what without dueAt (null)', () => {
    const raw = JSON.stringify({ what: 'медитировать', dueAt: null });
    const result = parseCommitmentResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });

  it('strips markdown code fences', () => {
    const inner = JSON.stringify({ what: 'X', dueAt: null });
    const wrapped = '```json\n' + inner + '\n```';
    expect(parseCommitmentResponse(wrapped)).not.toBeNull();
  });

  it('returns null for invalid JSON (never throws)', () => {
    expect(parseCommitmentResponse('garbage')).toBeNull();
  });

  it('returns null for missing what field', () => {
    expect(parseCommitmentResponse(JSON.stringify({ dueAt: null }))).toBeNull();
  });

  it('returns null for empty what', () => {
    expect(parseCommitmentResponse(JSON.stringify({ what: '   ', dueAt: null }))).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCommitmentResponse('')).toBeNull();
  });

  it('handles invalid dueAt by setting dueAt to null', () => {
    const result = parseCommitmentResponse(
      JSON.stringify({ what: 'X', dueAt: 'not a date' }),
    );
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// procedural-memory.ts structural — extractCommitmentPatterns
// ---------------------------------------------------------------------------

describe('procedural-memory.ts structural — extractCommitmentPatterns', () => {
  it('exports extractCommitmentPatterns', () => {
    expect(SRC).toMatch(/export async function extractCommitmentPatterns/);
  });

  it('exports matchesCommitmentPhrase pure helper', () => {
    expect(SRC).toMatch(/export function matchesCommitmentPhrase/);
  });

  it('exports parseCommitmentResponse pure helper', () => {
    expect(SRC).toMatch(/export function parseCommitmentResponse/);
  });

  it('queries last 7 days of ChatMessage', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('chatMessage');
    expect(body).toContain('7');
  });

  it('filters role=user and crisis=false', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'user'");
    expect(body).toContain('crisis');
  });

  it('uses matchesCommitmentPhrase prefilter before Claude call', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('matchesCommitmentPhrase(');
  });

  it('calls anthropic.messages.create with MODELS.haiku', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
    expect(body).toContain('MODELS.haiku');
  });

  it('uses parseCommitmentResponse to parse Claude output', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseCommitmentResponse(');
  });

  it('creates Pattern with kind=commitment', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'commitment'");
  });

  it('wraps Claude call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

// ---------------------------------------------------------------------------
// weekIndex
// ---------------------------------------------------------------------------

describe('weekIndex — pure helper', () => {
  it('returns 1 for date equal to startDate', async () => {
    const { weekIndex } = await import('./procedural-memory.js');
    const start = new Date('2026-01-01T00:00:00Z');
    expect(weekIndex(start, start)).toBe(1);
  });

  it('returns 1 for date 6 days after start', async () => {
    const { weekIndex } = await import('./procedural-memory.js');
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-07T00:00:00Z'); // exactly 6 days
    expect(weekIndex(start, d)).toBe(1);
  });

  it('returns 2 for date 7 days after start', async () => {
    const { weekIndex } = await import('./procedural-memory.js');
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-08T00:00:00Z');
    expect(weekIndex(start, d)).toBe(2);
  });

  it('returns 3 for date ~14 days after start', async () => {
    const { weekIndex } = await import('./procedural-memory.js');
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-15T00:00:00Z');
    expect(weekIndex(start, d)).toBe(3);
  });

  it('returns 1 for date before startDate (clamped)', async () => {
    const { weekIndex } = await import('./procedural-memory.js');
    const start = new Date('2026-01-15T00:00:00Z');
    const d = new Date('2026-01-01T00:00:00Z');
    expect(weekIndex(start, d)).toBe(1);
  });
});

describe('procedural-memory.ts structural — extractStreakBreakPatterns', () => {
  it('exports extractStreakBreakPatterns', () => {
    expect(SRC).toMatch(/export async function extractStreakBreakPatterns/);
  });

  it('exports weekIndex helper', () => {
    expect(SRC).toMatch(/export function weekIndex/);
  });

  it('requires habits with >= 42 logs (6 weeks)', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('42');
  });

  it('uses weekIndex helper to bucket logs', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('weekIndex(');
  });

  it('checks completion rate < 0.3 (break threshold)', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('0.3');
  });

  it('requires same week appears as break >= 2 times', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('>= 2');
  });

  it('creates Pattern with kind=streak_break', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain("'streak_break'");
  });

  it('wraps per-habit work in try/catch', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

describe('procedural-memory.ts structural — extractPatterns orchestrator', () => {
  it('extractPatterns calls all 5 extractors', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('extractFrequencyPatterns');
    expect(body).toContain('extractTimeOfDayPatterns');
    expect(body).toContain('extractRecurringTopicPatterns');
    expect(body).toContain('extractCommitmentPatterns');
    expect(body).toContain('extractStreakBreakPatterns');
  });

  it('extractPatterns uses Promise.allSettled (resilient to per-extractor failure)', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('Promise.allSettled');
  });

  it('extractPatterns dedupes by (kind, JSON.stringify(payload))', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('JSON.stringify');
  });
});
