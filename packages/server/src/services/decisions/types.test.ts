import { describe, it, expect } from 'vitest';
import { parseVerdict, computeWinRate, describeDecisionReview } from './types.js';

describe('parseVerdict', () => {
  it('canonical values pass through', () => {
    expect(parseVerdict('worked')).toBe('worked');
    expect(parseVerdict('didnt')).toBe('didnt');
    expect(parseVerdict('mixed')).toBe('mixed');
  });
  it('russian synonyms map', () => {
    expect(parseVerdict('сработало')).toBe('worked');
    expect(parseVerdict('Да')).toBe('worked');
    expect(parseVerdict('нет')).toBe('didnt');
    expect(parseVerdict('провал')).toBe('didnt');
    expect(parseVerdict('частично')).toBe('mixed');
  });
  it('junk → null', () => {
    expect(parseVerdict('бла')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });
});

describe('computeWinRate', () => {
  it('only worked counts; mixed/didnt/null do not', () => {
    const r = computeWinRate([
      { verdict: 'worked' },
      { verdict: 'worked' },
      { verdict: 'mixed' },
      { verdict: 'didnt' },
      { verdict: null },
    ]);
    expect(r).toEqual({ reviewed: 5, worked: 2, rate: 0.4 });
  });
  it('empty → rate null', () => {
    expect(computeWinRate([])).toEqual({ reviewed: 0, worked: 0, rate: null });
  });
  it('all worked → 1', () => {
    expect(computeWinRate([{ verdict: 'worked' }]).rate).toBe(1);
  });
});

describe('describeDecisionReview', () => {
  it('mentions title, expected, weeks ago', () => {
    const now = new Date('2026-06-04');
    const s = describeDecisionReview(
      { title: 'нанять Айгуль', expectedOutcome: 'закрыть найм', decidedAt: new Date('2026-05-07') },
      now,
    );
    expect(s).toMatch(/нанять Айгуль/);
    expect(s).toMatch(/закрыть найм/);
    expect(s).toMatch(/нед/);
  });
  it('handles null expectedOutcome', () => {
    const s = describeDecisionReview(
      { title: 'X', expectedOutcome: null, decidedAt: new Date('2026-05-07') },
      new Date('2026-06-04'),
    );
    expect(s).toMatch(/X/);
  });
});
