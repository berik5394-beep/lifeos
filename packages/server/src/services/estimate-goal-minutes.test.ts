import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoalMinutes } from './estimate-goal-minutes.js';

describe('parseGoalMinutes — чистый парсер минут/нед', () => {
  it('число в диапазоне → как есть', () => {
    expect(parseGoalMinutes('120')).toBe(120);
    expect(parseGoalMinutes('примерно 300 минут')).toBe(300);
  });
  it('0 → 0 (цель не про время, напр. деньги)', () => {
    expect(parseGoalMinutes('0')).toBe(0);
  });
  it('ниже MIN (15) → кламп', () => {
    expect(parseGoalMinutes('5')).toBe(15);
  });
  it('выше MAX (1200) → кламп', () => {
    expect(parseGoalMinutes('9999')).toBe(1200);
  });
  it('нет числа / мусор → DEFAULT (120)', () => {
    expect(parseGoalMinutes('не знаю')).toBe(120);
    expect(parseGoalMinutes('')).toBe(120);
  });
});

describe('estimate-goal-minutes — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/estimate-goal-minutes.ts'), 'utf-8');
  it('haiku через createAnthropic + MODELS.haiku', () => {
    expect(SRC).toContain('createAnthropic');
    expect(SRC).toContain('MODELS.haiku');
  });
  it('фоновый писатель: гейт флагом + идемпотентный updateMany', () => {
    expect(SRC).toContain('isV2MonthLoadEnabled');
    expect(SRC).toMatch(/weeklyGoal\.updateMany/);
    expect(SRC).toMatch(/estimatedMinutes: null/);
  });
});
