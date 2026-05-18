import { describe, it, expect } from 'vitest';
import { streakDecision, STREAK_DAY_THRESHOLD } from './pet-streak-service.js';

/**
 * A.1 — чистое решение стрика. Раньше Pet.streak вообще не писался;
 * это ядро оживлённой мета-игры — фиксируем регрессом.
 */
describe('streakDecision', () => {
  it(`>= ${STREAK_DAY_THRESHOLD}% (был день) → стрик +1`, () => {
    expect(streakDecision(0, 60, true)).toBe(1);
    expect(streakDecision(4, 75, true)).toBe(5);
    expect(streakDecision(99, 100, true)).toBe(100);
  });
  it(`< ${STREAK_DAY_THRESHOLD}% (был день) → сброс в 0`, () => {
    expect(streakDecision(10, 59, true)).toBe(0);
    expect(streakDecision(3, 0, true)).toBe(0);
  });
  it('граница ровно порог = засчитывается', () => {
    expect(streakDecision(2, STREAK_DAY_THRESHOLD, true)).toBe(3);
  });
  it('пустой день (0 задач/0 привычек) → стрик НЕ меняется', () => {
    // главный фикс: нечего было делать ≠ провал, серию не рвём
    expect(streakDecision(7, 0, false)).toBe(7);
    expect(streakDecision(0, 0, false)).toBe(0);
    // даже если pct случайно высокий — без активности не +1
    expect(streakDecision(5, 100, false)).toBe(5);
  });
});
