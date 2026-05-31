import { describe, it, expect } from 'vitest';
import {
  logNorm,
  computeRelationshipDepth,
  computeBotTraits,
  traitLabel,
  parseTraitsJson,
  DEFAULT_TRAITS,
  BOT_TRAIT_NAMES,
} from './types.js';

describe('logNorm', () => {
  it('zero or negative → 0', () => {
    expect(logNorm(0, 100)).toBe(0);
    expect(logNorm(-5, 100)).toBe(0);
  });
  it('at cap → ~1', () => {
    expect(logNorm(100, 100)).toBeCloseTo(1, 5);
  });
  it('monotonic increasing', () => {
    expect(logNorm(10, 100)).toBeLessThan(logNorm(50, 100));
  });
  it('bounded to [0, 1]', () => {
    expect(logNorm(1000, 100)).toBe(1);
  });
});

describe('computeRelationshipDepth', () => {
  it('all-zero stats → 0', () => {
    expect(computeRelationshipDepth({
      messageCount: 0, daysSinceFirst: 0, distinctEntities: 0, emotionalMoments: 0,
    })).toBe(0);
  });
  it('maxed stats → close to 1', () => {
    const d = computeRelationshipDepth({
      messageCount: 500, daysSinceFirst: 365, distinctEntities: 100, emotionalMoments: 50,
    });
    expect(d).toBeGreaterThan(0.9);
  });
  it('monotonic in messageCount', () => {
    const base = { daysSinceFirst: 30, distinctEntities: 10, emotionalMoments: 5 };
    expect(computeRelationshipDepth({ ...base, messageCount: 10 }))
      .toBeLessThan(computeRelationshipDepth({ ...base, messageCount: 200 }));
  });
  it('bounded to [0, 1]', () => {
    const d = computeRelationshipDepth({
      messageCount: 99999, daysSinceFirst: 99999, distinctEntities: 9999, emotionalMoments: 9999,
    });
    expect(d).toBeLessThanOrEqual(1);
    expect(d).toBeGreaterThanOrEqual(0);
  });
});

describe('computeBotTraits', () => {
  it('neutral axes + depth 0 baseline', () => {
    const t = computeBotTraits(0.5, 0.5, 0);
    expect(t.warmth).toBeCloseTo(0.60, 2);
    expect(t.directness).toBeCloseTo(0.525, 2);
    expect(t.humor).toBeCloseTo(0.275, 2);
    expect(t.playfulness).toBeCloseTo(0.40, 2);
  });
  it('monotonic in depth — bot warms over time', () => {
    const low = computeBotTraits(0.5, 0.5, 0.1);
    const high = computeBotTraits(0.5, 0.5, 0.9);
    expect(high.warmth).toBeGreaterThan(low.warmth);
    expect(high.directness).toBeGreaterThan(low.directness);
    expect(high.humor).toBeGreaterThan(low.humor);
    expect(high.playfulness).toBeGreaterThan(low.playfulness);
  });
  it('warmth responds to userEO', () => {
    const lowEO = computeBotTraits(0.1, 0.5, 0.3);
    const highEO = computeBotTraits(0.9, 0.5, 0.3);
    expect(highEO.warmth).toBeGreaterThan(lowEO.warmth);
  });
  it('directness responds to userCT', () => {
    const lowCT = computeBotTraits(0.5, 0.1, 0.3);
    const highCT = computeBotTraits(0.5, 0.9, 0.3);
    expect(highCT.directness).toBeGreaterThan(lowCT.directness);
  });
  it('all traits clamped to [0, 1]', () => {
    const t = computeBotTraits(1, 1, 1);
    Object.values(t).forEach((v) => {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('traitLabel', () => {
  it('buckets correctly', () => {
    expect(traitLabel(0.1)).toBe('очень низкий');
    expect(traitLabel(0.3)).toBe('низкий');
    expect(traitLabel(0.5)).toBe('средний');
    expect(traitLabel(0.75)).toBe('высокий');
    expect(traitLabel(0.95)).toBe('очень высокий');
  });
});

describe('parseTraitsJson', () => {
  it('valid traits object', () => {
    const json = {
      warmth: 0.6, directness: 0.5, humor: 0.3, playfulness: 0.4,
      relationshipDepth: 0.2, lastComputedAt: '2026-05-31T09:00:00Z',
    };
    const out = parseTraitsJson(json);
    expect(out.warmth).toBe(0.6);
    expect(out.relationshipDepth).toBe(0.2);
    expect(out.lastComputedAt).toBeInstanceOf(Date);
  });
  it('empty object → DEFAULT_TRAITS', () => {
    const out = parseTraitsJson({});
    expect(out.warmth).toBe(DEFAULT_TRAITS.warmth);
    expect(out.lastComputedAt).toBeNull();
  });
  it('null → DEFAULT_TRAITS', () => {
    expect(parseTraitsJson(null).warmth).toBe(DEFAULT_TRAITS.warmth);
  });
  it('partial object fills missing with defaults', () => {
    const out = parseTraitsJson({ warmth: 0.9 });
    expect(out.warmth).toBe(0.9);
    expect(out.directness).toBe(DEFAULT_TRAITS.directness);
  });
  it('malformed lastComputedAt → null', () => {
    const out = parseTraitsJson({ warmth: 0.5, lastComputedAt: 'garbage' });
    expect(out.lastComputedAt).toBeNull();
  });
});

describe('BOT_TRAIT_NAMES', () => {
  it('has exactly 4 entries', () => {
    expect(BOT_TRAIT_NAMES).toEqual(['warmth', 'directness', 'humor', 'playfulness']);
  });
});
