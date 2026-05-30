import { describe, it, expect } from 'vitest';
import {
  clampValence,
  clampArousal,
  normalizeEmotionLabel,
  parseMoodResponse,
} from './emotional-memory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('clampValence — pure helper', () => {
  it('passes through values in [-1, 1]', () => {
    expect(clampValence(0)).toBe(0);
    expect(clampValence(-1)).toBe(-1);
    expect(clampValence(1)).toBe(1);
    expect(clampValence(0.5)).toBe(0.5);
  });

  it('clamps below -1 to -1', () => {
    expect(clampValence(-2)).toBe(-1);
    expect(clampValence(-100)).toBe(-1);
  });

  it('clamps above 1 to 1', () => {
    expect(clampValence(2)).toBe(1);
    expect(clampValence(100)).toBe(1);
  });

  it('returns 0 for NaN (safe default)', () => {
    expect(clampValence(Number.NaN)).toBe(0);
  });
});

describe('clampArousal — pure helper', () => {
  it('passes through values in [0, 1]', () => {
    expect(clampArousal(0)).toBe(0);
    expect(clampArousal(1)).toBe(1);
    expect(clampArousal(0.5)).toBe(0.5);
  });

  it('clamps below 0 to 0', () => {
    expect(clampArousal(-0.5)).toBe(0);
  });

  it('clamps above 1 to 1', () => {
    expect(clampArousal(2)).toBe(1);
  });

  it('returns 0.5 for NaN', () => {
    expect(clampArousal(Number.NaN)).toBe(0.5);
  });
});

describe('normalizeEmotionLabel — pure helper', () => {
  it('passes through known labels case-insensitively', () => {
    expect(normalizeEmotionLabel('sad')).toBe('sad');
    expect(normalizeEmotionLabel('SAD')).toBe('sad');
    expect(normalizeEmotionLabel('Happy')).toBe('happy');
    expect(normalizeEmotionLabel('anxious')).toBe('anxious');
    expect(normalizeEmotionLabel('angry')).toBe('angry');
    expect(normalizeEmotionLabel('neutral')).toBe('neutral');
    expect(normalizeEmotionLabel('mixed')).toBe('mixed');
  });

  it('maps unknown labels to neutral', () => {
    expect(normalizeEmotionLabel('confused')).toBe('neutral');
    expect(normalizeEmotionLabel('')).toBe('neutral');
    expect(normalizeEmotionLabel('грустно')).toBe('neutral');
  });
});

describe('parseMoodResponse — pure helper', () => {
  it('parses valid JSON', () => {
    const raw = JSON.stringify({ valence: -0.5, arousal: 0.7, emotion: 'sad' });
    expect(parseMoodResponse(raw)).toEqual({ valence: -0.5, arousal: 0.7, emotion: 'sad' });
  });

  it('strips markdown code fences', () => {
    const inner = JSON.stringify({ valence: 0.3, arousal: 0.5, emotion: 'happy' });
    const wrapped = '```json\n' + inner + '\n```';
    expect(parseMoodResponse(wrapped).emotion).toBe('happy');
  });

  it('returns safe default for invalid JSON', () => {
    expect(parseMoodResponse('garbage')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });

  it('returns safe default for empty', () => {
    expect(parseMoodResponse('')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });

  it('clamps out-of-range valence and arousal', () => {
    const raw = JSON.stringify({ valence: -5, arousal: 2, emotion: 'sad' });
    expect(parseMoodResponse(raw)).toEqual({ valence: -1, arousal: 1, emotion: 'sad' });
  });

  it('normalizes unknown emotion to neutral', () => {
    const raw = JSON.stringify({ valence: 0, arousal: 0.5, emotion: 'whatever' });
    expect(parseMoodResponse(raw).emotion).toBe('neutral');
  });

  it('uses defaults for missing fields', () => {
    expect(parseMoodResponse('{}')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/emotional-memory.ts'),
  'utf-8',
);

describe('emotional-memory.ts structural — skeleton + analyzeMessage', () => {
  it('exports EmotionalMemory class', () => {
    expect(SRC).toMatch(/export class EmotionalMemory/);
  });

  it('declares EmotionalMemoryStore interface', () => {
    expect(SRC).toMatch(/export interface EmotionalMemoryStore/);
  });

  it('class implements EmotionalMemoryStore', () => {
    expect(SRC).toMatch(/implements EmotionalMemoryStore/);
  });

  it('re-exports MoodSnapshot type', () => {
    expect(SRC).toMatch(/export type \{[^}]*MoodSnapshot[^}]*\}/);
  });

  it('exports clampValence, clampArousal, normalizeEmotionLabel, parseMoodResponse', () => {
    expect(SRC).toMatch(/export function clampValence/);
    expect(SRC).toMatch(/export function clampArousal/);
    expect(SRC).toMatch(/export function normalizeEmotionLabel/);
    expect(SRC).toMatch(/export function parseMoodResponse/);
  });

  it('analyzeMessage exported as async method', () => {
    expect(SRC).toMatch(/async analyzeMessage\s*\(/);
  });

  it('analyzeMessage calls anthropic.messages.create with MODELS.haiku', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
    expect(body).toContain('MODELS.haiku');
  });

  it('analyzeMessage wraps Claude call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });

  it('analyzeMessage writes MoodSnapshot row', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('prisma.moodSnapshot.create');
  });

  it('analyzeMessage uses parseMoodResponse', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseMoodResponse(');
  });

  it('analyzeMessage falls back to neutral on error (never throws)', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("emotion: 'neutral'");
  });

  it('system prompt instructs JSON-only output', () => {
    expect(SRC).toMatch(/ТОЛЬКО.*JSON|ONLY.*JSON|valid JSON/s);
  });
});

import { groupByDay, dominantEmotion } from './emotional-memory.js';

describe('dominantEmotion — pure helper', () => {
  it('returns mode for clear majority', () => {
    expect(dominantEmotion(['sad', 'sad', 'happy'])).toBe('sad');
  });

  it('returns "neutral" for empty', () => {
    expect(dominantEmotion([])).toBe('neutral');
  });

  it('breaks ties alphabetically (deterministic)', () => {
    expect(dominantEmotion(['happy', 'sad'])).toBe('happy'); // 'h' < 's'
  });
});

describe('groupByDay — pure helper', () => {
  it('returns empty array for empty input', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('groups two snapshots same day, avg valence, dominant emotion', () => {
    const snaps = [
      { recordedAt: new Date('2026-05-29T10:00:00Z'), valence: 0.4, emotion: 'happy' },
      { recordedAt: new Date('2026-05-29T20:00:00Z'), valence: 0.6, emotion: 'happy' },
    ];
    const result = groupByDay(snaps);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-05-29');
    expect(result[0].valence).toBeCloseTo(0.5, 2);
    expect(result[0].emotion).toBe('happy');
  });

  it('returns days sorted ascending', () => {
    const snaps = [
      { recordedAt: new Date('2026-05-30T10:00:00Z'), valence: 0.2, emotion: 'happy' },
      { recordedAt: new Date('2026-05-29T10:00:00Z'), valence: -0.2, emotion: 'sad' },
    ];
    const result = groupByDay(snaps);
    expect(result[0].date).toBe('2026-05-29');
    expect(result[1].date).toBe('2026-05-30');
  });
});

describe('emotional-memory.ts structural — getMoodTimeline / getEntityMood', () => {
  it('exports groupByDay helper', () => {
    expect(SRC).toMatch(/export function groupByDay/);
  });

  it('exports dominantEmotion helper', () => {
    expect(SRC).toMatch(/export function dominantEmotion/);
  });

  it('getMoodTimeline queries MoodSnapshot.findMany', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.moodSnapshot.findMany');
  });

  it('getMoodTimeline filters source=message', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain("'message'");
  });

  it('getMoodTimeline calls groupByDay', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('groupByDay(');
  });

  it('getEntityMood filters entityRefs has entityId', () => {
    const start = SRC.indexOf('async getEntityMood');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('entityRefs');
    expect(body).toContain('has:');
  });

  it('getEntityMood returns 0 if no rows', () => {
    const start = SRC.indexOf('async getEntityMood');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/return 0|=== 0/);
  });
});

import { computeShiftMagnitude } from './emotional-memory.js';

describe('computeShiftMagnitude — pure helper', () => {
  it('returns magnitude 0 and direction null for identical avgs', () => {
    const r = computeShiftMagnitude([0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(r.magnitude).toBe(0);
    expect(r.direction).toBeNull();
  });

  it('returns positive magnitude for upward shift', () => {
    const r = computeShiftMagnitude([0.8, 0.9], [0.1, 0.2, 0.0, 0.1, 0.0]);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.direction).toBe('up');
  });

  it('returns positive magnitude for downward shift with direction down', () => {
    const r = computeShiftMagnitude([-0.8, -0.9], [0.1, 0.2, 0.0, 0.1, 0.0]);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.direction).toBe('down');
  });

  it('handles zero baseline stddev (all same) by raw diff', () => {
    const r = computeShiftMagnitude([1.0], [0.5, 0.5, 0.5]);
    expect(r.magnitude).toBeCloseTo(0.5, 5);
    expect(r.direction).toBe('up');
  });

  it('handles small baseline (< 2) by raw diff', () => {
    const r = computeShiftMagnitude([0.5], [0.0]);
    expect(r.magnitude).toBeCloseTo(0.5, 5);
    expect(r.direction).toBe('up');
  });

  it('handles empty recent (magnitude 0, direction null)', () => {
    const r = computeShiftMagnitude([], [0.1, 0.2]);
    expect(r.magnitude).toBe(0);
    expect(r.direction).toBeNull();
  });
});

describe('emotional-memory.ts structural — detectMoodShift', () => {
  it('exports computeShiftMagnitude helper', () => {
    expect(SRC).toMatch(/export function computeShiftMagnitude/);
  });

  it('detectMoodShift queries last ~17 days of snapshots', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toMatch(/17|14[\s\S]*?3/);
  });

  it('detectMoodShift uses computeShiftMagnitude', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('computeShiftMagnitude(');
  });

  it('detectMoodShift checks magnitude >= 1.0 threshold', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('1.0');
  });

  it('detectMoodShift returns null on insufficient data', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('return null');
  });

  it('detectMoodShift returns { shifted: true, direction, magnitude, sinceDays: 3 } when shifted', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('shifted: true');
    expect(body).toContain('sinceDays: 3');
  });
});

// ---------------------------------------------------------------------------
// F2 fix (2026-05-30): analyzeMessage accepts entityRefs param
// ---------------------------------------------------------------------------
describe('analyzeMessage — entityRefs propagation (F2 fix)', () => {
  it('signature exposes optional entityRefs parameter', () => {
    expect(SRC).toMatch(/entityRefs(\?:|\s*:)\s*string\[\]/);
  });
  it('persists supplied entityRefs to MoodSnapshot row', () => {
    const fn = SRC.slice(SRC.indexOf('async analyzeMessage'));
    const body = fn.slice(0, 1500);
    expect(body).not.toMatch(/entityRefs:\s*\[\]/);
    expect(body).toMatch(/entityRefs(,|\s*})/);
  });
  it('interface signature also exposes entityRefs', () => {
    const iface = SRC.slice(SRC.indexOf('export interface EmotionalMemoryStore'));
    const ifaceBody = iface.slice(0, 600);
    expect(ifaceBody).toMatch(/entityRefs\?: string\[\]/);
  });
});
