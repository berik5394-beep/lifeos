import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMoneyGoal, computeGoalPace, describeGoalPace } from './goal-pace.js';

describe('isMoneyGoal', () => {
  it('finance + target → деньги (исключаем)', () => {
    expect(isMoneyGoal('finance', 1_000_000)).toBe(true);
  });
  it('finance без target → не деньги', () => {
    expect(isMoneyGoal('finance', null)).toBe(false);
  });
  it('career/health → не деньги', () => {
    expect(isMoneyGoal('career', 50)).toBe(false);
    expect(isMoneyGoal('health', 10)).toBe(false);
  });
});

describe('computeGoalPace', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-01T00:00:00Z'); // ~6 мес прошло
  it('reached → status reached', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 100, createdAt: created }, now);
    expect(p.status).toBe('reached');
    expect(p.done).toBe(50);
  });
  it('behind: 20% за полгода, цель к концу года', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 20, createdAt: created }, now);
    expect(p.status).toBe('behind');
    expect(Math.round(p.done)).toBe(10);
    expect(p.currentMonthly).toBeGreaterThan(0);
  });
  it('monthsElapsed<0.5 → currentMonthly 0', () => {
    const fresh = new Date('2026-06-28T00:00:00Z');
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 10, createdAt: fresh }, now);
    expect(p.currentMonthly).toBe(0);
    expect(p.monthsElapsed).toBeLessThan(0.5);
  });
  it('target=0 → done 0, no_target', () => {
    const p = computeGoalPace({ target: 0, targetDate: null, progress: 50, createdAt: created }, now);
    expect(p.done).toBe(0);
    expect(p.status).toBe('no_target');
  });
});

describe('describeGoalPace', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-01T00:00:00Z');
  it('behind → строка с «нужно ~X/мес»', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 20, createdAt: created }, now);
    const s = describeGoalPace('Прочитать 50 книг', p, 50)!;
    expect(s).toContain('Прочитать 50 книг');
    expect(s).toContain('нужно');
    expect(s).toContain('из 50');
  });
  it('reached → null', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 100, createdAt: created }, now);
    expect(describeGoalPace('x', p, 50)).toBeNull();
  });
});

describe('goal-pace — проводка maybeGoalPaceLine (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/goal-pace.ts'), 'utf-8');
  it('гейт флагом + дедуп против СВОИХ goal:pace + source goal_pace', () => {
    expect(SRC).toContain('isV2YearLoadEnabled');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'goal_pace'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'goal:pace:'");
  });
});
