import { describe, it, expect } from 'vitest';
import {
  significanceScore,
  summariseFactsForPrompt,
  parseKeystone,
  shouldFireEvent,
  EVENT_THRESHOLD,
  type ReflectorV2Facts,
} from './types.js';

const baseLegacy = {
  monthlyBurn: 0, monthlyIncome: 0, habitConsistency: 1,
  goalsBehind: 0, tasksStale: 0, budgetPct: 0,
};

describe('significanceScore', () => {
  it('low when everything is fine', () => {
    const f: ReflectorV2Facts = { legacy: baseLegacy };
    expect(significanceScore(f)).toBeLessThan(EVENT_THRESHOLD);
  });
  it('high when multiple tiers point negative (compound signal)', () => {
    const f: ReflectorV2Facts = {
      moodTrend: { current: -0.4, deltaWeek: -0.4, shift: true },
      legacy: { ...baseLegacy, habitConsistency: 0.2, budgetPct: 0.95, goalsBehind: 2, tasksStale: 5 },
    };
    expect(significanceScore(f)).toBeGreaterThanOrEqual(EVENT_THRESHOLD);
  });
  it('clamped to [0,1]', () => {
    const f: ReflectorV2Facts = {
      moodTrend: { current: -1, deltaWeek: -1, shift: true },
      legacy: { ...baseLegacy, habitConsistency: 0, budgetPct: 2, goalsBehind: 9, tasksStale: 99 },
    };
    const s = significanceScore(f);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('shouldFireEvent', () => {
  it('mirrors significanceScore vs threshold', () => {
    const lo: ReflectorV2Facts = { legacy: baseLegacy };
    expect(shouldFireEvent(lo)).toBe(false);
  });
});

describe('summariseFactsForPrompt', () => {
  it('includes present tiers and omits absent ones', () => {
    const f: ReflectorV2Facts = {
      axes: { selfDiscipline: 0.3, emotionalOpenness: 0.7, conflictTolerance: 0.4, introspectionDepth: 0.5 },
      legacy: baseLegacy,
    };
    const out = summariseFactsForPrompt(f);
    expect(out).toMatch(/self.?discipline|self_discipline|self-discipline/i);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('parseKeystone', () => {
  it('parses a valid keystone', () => {
    const k = parseKeystone(JSON.stringify({
      message: 'Сосредоточься на сне', rationale: 'mood↓ + late', severity: 7,
      scopeTheme: 'health', suggestedAction: null,
    }));
    expect(k?.message).toBe('Сосредоточься на сне');
    expect(k?.severity).toBe(7);
    expect(k?.scopeTheme).toBe('health');
  });
  it('strips fences and clamps severity', () => {
    const k = parseKeystone('```json\n{"message":"x","rationale":"y","severity":99,"scopeTheme":"goals"}\n```');
    expect(k?.severity).toBe(10);
  });
  it('returns null on garbage / missing fields', () => {
    expect(parseKeystone('not json')).toBeNull();
    expect(parseKeystone(JSON.stringify({ message: 'x' }))).toBeNull();
    expect(parseKeystone('')).toBeNull();
  });
});
