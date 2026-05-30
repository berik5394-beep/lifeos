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

describe('structural — A3 detectors', () => {
  it('defines detectMoodShift importing emotional-memory singleton', () => {
    expect(SRC).toMatch(/from '\.\/emotional-memory\.singleton\.js'/);
    expect(SRC).toMatch(/function detectMoodShift\s*\(/);
    expect(SRC).toMatch(/detectMoodShift\(userId\)/);
  });
  it('defines detectStreakBreak using prisma habitLog', () => {
    expect(SRC).toMatch(/function detectStreakBreak\s*\(/);
    expect(SRC).toMatch(/habitLog|HabitLog/);
  });
  it('defines detectGoalNoProgress reading YearlyGoal', () => {
    expect(SRC).toMatch(/function detectGoalNoProgress\s*\(/);
    expect(SRC).toMatch(/yearlyGoal\.findMany/);
  });
  it('all 5 detectors are wrapped in try/catch', () => {
    const matches = SRC.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,160}?return\s*\[\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});

describe('structural — A4 gates + filterCandidates', () => {
  it('exports/uses 4 gates in correct order', () => {
    expect(SRC).toMatch(/function gate1_DND\s*\(/);
    expect(SRC).toMatch(/function gate2_RateLimit\s*\(/);
    // gate3_Significance already exported (A1)
    expect(SRC).toMatch(/function gate4_Dedup\s*\(/);
    // order: DND must appear before RateLimit appear before Dedup inside filterCandidates method body
    // Extract the filterCandidates method starting from "async filterCandidates"
    const filterCandStart = SRC.indexOf('async filterCandidates');
    const methodBody = SRC.slice(filterCandStart);
    expect(methodBody.indexOf('gate1_DND')).toBeLessThan(methodBody.indexOf('gate2_RateLimit'));
    expect(methodBody.indexOf('gate2_RateLimit')).toBeLessThan(methodBody.indexOf('gate4_Dedup'));
    // gate3_Significance call should be between gate2 and gate4
    expect(methodBody.indexOf('gate2_RateLimit')).toBeLessThan(methodBody.indexOf('gate3_Significance'));
  });
  it('gate2 caps at 2/day with source filter', () => {
    expect(SRC).toMatch(/source:\s*'v2-proactivity'/);
    expect(SRC).toMatch(/<\s*2\b|todayCount\s*<\s*2/);
  });
  it('gate4 uses 7-day window on metadata.entityId', () => {
    expect(SRC).toMatch(/path:\s*\['entityId'\]/);
    expect(SRC).toMatch(/7\s*\*\s*DAY_MS|subDays\(\s*\w+\s*,\s*7\s*\)/);
  });
});

describe('structural — A5 generateNudge', () => {
  it('imports runAgent + getBotIdentityService', () => {
    expect(SRC).toMatch(/from '\.\/claude-agent\.js'/);
    expect(SRC).toMatch(/from '\.\/bot-identity\.singleton\.js'/);
  });
  it('looks up TEMPLATES[source][toneHint] before fallback', () => {
    const body = SRC.slice(SRC.indexOf('generateNudge'));
    expect(body.indexOf('TEMPLATES[')).toBeLessThan(body.indexOf('runAgent('));
  });
  it('uses interpolate on the template', () => {
    expect(SRC).toMatch(/interpolate\(\s*template/);
  });
  it('has a safe fallback string when Claude fails', () => {
    expect(SRC).toMatch(/Подумал о тебе — как ты\?/);
  });
});
