import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scoreSignificance,
  gate3_Significance,
  interpolate,
  TEMPLATES,
} from './v2-proactivity-engine.js';
import type { NudgeCandidate } from './v2-proactivity-engine.js';

const SRC = readFileSync(
  join(__dirname, 'v2-proactivity-engine.ts'),
  'utf8',
);

describe('scoreSignificance — pure', () => {
  it('stale_entity scales by gapRatio and importance', () => {
    const c: NudgeCandidate = {
      source: 'stale_entity',
      significance: 0,
      payload: { gapRatio: 5, importance: 10 },
      toneHint: 'gentle',
    };
    expect(scoreSignificance(c)).toBe(1);
  });

  it('stale_entity defaults importance=5 when missing', () => {
    const c: NudgeCandidate = {
      source: 'stale_entity',
      significance: 0,
      payload: { gapRatio: 10 },
      toneHint: 'gentle',
    };
    // (10/5) * (5/10) = 1
    expect(scoreSignificance(c)).toBe(1);
  });

  it('commitment_due grows with daysOverdue and caps at 1', () => {
    expect(
      scoreSignificance({
        source: 'commitment_due',
        significance: 0,
        payload: { daysOverdue: 0 },
        toneHint: 'curious',
      }),
    ).toBe(0.5);
    expect(
      scoreSignificance({
        source: 'commitment_due',
        significance: 0,
        payload: { daysOverdue: 14 },
        toneHint: 'curious',
      }),
    ).toBe(1);
  });

  it('mood_shift uses |magnitude|', () => {
    expect(
      scoreSignificance({
        source: 'mood_shift',
        significance: 0,
        payload: { magnitude: -0.8 },
        toneHint: 'supportive',
      }),
    ).toBe(0.8);
  });

  it('streak_break = consistency * 0.8', () => {
    expect(
      scoreSignificance({
        source: 'streak_break',
        significance: 0,
        payload: { consistency: 1 },
        toneHint: 'gentle',
      }),
    ).toBe(0.8);
  });

  it('goal_no_progress scales daysSilent / 14', () => {
    expect(
      scoreSignificance({
        source: 'goal_no_progress',
        significance: 0,
        payload: { daysSilent: 7 },
        toneHint: 'curious',
      }),
    ).toBe(0.5);
  });
});

describe('gate3_Significance — pure', () => {
  const base = (s: number): NudgeCandidate => ({
    source: 'stale_entity',
    significance: s,
    payload: {},
    toneHint: 'gentle',
  });
  it('passes >=0.6 by default', () => {
    expect(gate3_Significance(base(0.6))).toBe(true);
    expect(gate3_Significance(base(0.59))).toBe(false);
  });
  it('honours custom threshold', () => {
    expect(gate3_Significance(base(0.4), 0.3)).toBe(true);
    expect(gate3_Significance(base(0.2), 0.3)).toBe(false);
  });
});

describe('interpolate — pure', () => {
  it('replaces {{key}} occurrences', () => {
    expect(interpolate('Hi {{name}}!', { name: 'Берик' })).toBe('Hi Берик!');
  });
  it('repeats same key', () => {
    expect(interpolate('{{x}}-{{x}}', { x: 1 })).toBe('1-1');
  });
  it('missing key → empty string (no throw)', () => {
    expect(interpolate('a={{a}} b={{b}}', { a: 'A' })).toBe('a=A b=');
  });
  it('passes string through when no placeholders', () => {
    expect(interpolate('plain', { x: 1 })).toBe('plain');
  });
});

describe('TEMPLATES — table', () => {
  it('covers all 5 sources', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(
      [
        'commitment_due',
        'goal_no_progress',
        'mood_shift',
        'stale_entity',
        'streak_break',
      ].sort(),
    );
  });
  it('each source has at least one tone template', () => {
    for (const src of Object.values(TEMPLATES)) {
      expect(Object.keys(src).length).toBeGreaterThan(0);
    }
  });
});

describe('structural — module skeleton', () => {
  it('exports ProactivityEngine interface', () => {
    expect(SRC).toMatch(/export interface ProactivityEngine\b/);
  });
  it('exports NudgeCandidate type', () => {
    expect(SRC).toMatch(/export type NudgeCandidate\s*=/);
  });
  it('declares runForUser, detectCandidates, filterCandidates, generateNudge', () => {
    for (const m of [
      'runForUser',
      'detectCandidates',
      'filterCandidates',
      'generateNudge',
    ]) {
      expect(SRC).toMatch(new RegExp(`\\b${m}\\b`));
    }
  });
  it('placeholders throw with "not yet implemented" marker', () => {
    expect(SRC).toMatch(/not yet implemented — Task A/);
  });
});

describe('structural — A2 detectors', () => {
  it('imports getEntityGraph and getProceduralMemory', () => {
    expect(SRC).toMatch(/from '\.\/entity-graph\/index\.js'/);
    expect(SRC).toMatch(/from '\.\/procedural-memory\.singleton\.js'/);
  });
  it('defines detectStaleEntity', () => {
    expect(SRC).toMatch(/function detectStaleEntity\s*\(/);
    expect(SRC).toMatch(/staleEntities\s*\(\s*userId\s*,\s*7\s*,\s*5/);
    expect(SRC).toMatch(/lastEventForEntity/);
  });
  it('defines detectCommitmentDue with overdue calc', () => {
    expect(SRC).toMatch(/function detectCommitmentDue\s*\(/);
    expect(SRC).toMatch(/daysOverdue/);
  });
  it('each detector is wrapped in try/catch returning []', () => {
    // crude: count "return []" within ~50 chars of "catch" — two detectors
    const matches = SRC.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,120}?return\s*\[\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
