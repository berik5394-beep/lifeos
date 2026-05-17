import { describe, it, expect } from 'vitest';
import { streakDecision, STREAK_DAY_THRESHOLD } from './pet-streak-service.js';

/**
 * A.1 — чистое решение стрика. Раньше Pet.streak вообще не писался;
 * это ядро оживлённой мета-игры — фиксируем регрессом.
 */
describe('streakDecision', () => {
  it(`>= ${STREAK_DAY_THRESHOLD}% → стрик +1`, () => {
    expect(streakDecision(0, 60)).toBe(1);
    expect(streakDecision(4, 75)).toBe(5);
    expect(streakDecision(99, 100)).toBe(100);
  });
  it(`< ${STREAK_DAY_THRESHOLD}% → сброс в 0`, () => {
    expect(streakDecision(10, 59)).toBe(0);
    expect(streakDecision(3, 0)).toBe(0);
  });
  it('граница ровно порог = засчитывается', () => {
    expect(streakDecision(2, STREAK_DAY_THRESHOLD)).toBe(3);
  });
});
