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
