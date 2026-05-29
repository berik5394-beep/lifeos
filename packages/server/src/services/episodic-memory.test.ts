import { describe, it, expect } from 'vitest';
import { validateEventInput, clampMood } from './episodic-memory.js';

describe('clampMood — emotional valence -1..+1', () => {
  it('returns undefined for undefined input', () => {
    expect(clampMood(undefined)).toBeUndefined();
  });

  it('clamps below -1 to -1', () => {
    expect(clampMood(-5)).toBe(-1);
    expect(clampMood(-1.0001)).toBe(-1);
  });

  it('clamps above +1 to +1', () => {
    expect(clampMood(5)).toBe(1);
    expect(clampMood(1.0001)).toBe(1);
  });

  it('passes through values in [-1, +1]', () => {
    expect(clampMood(0)).toBe(0);
    expect(clampMood(-0.5)).toBe(-0.5);
    expect(clampMood(0.7)).toBe(0.7);
    expect(clampMood(-1)).toBe(-1);
    expect(clampMood(1)).toBe(1);
  });
});

describe('validateEventInput', () => {
  it('passes valid input', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'звонил маме',
        validAt: new Date('2026-05-28'),
      }),
    ).not.toThrow();
  });

  it('throws if content empty', () => {
    expect(() => validateEventInput({ type: 'event', content: '' })).toThrow(/content/);
    expect(() => validateEventInput({ type: 'event', content: '   ' })).toThrow(/content/);
  });

  it('throws if type empty', () => {
    expect(() => validateEventInput({ type: '', content: 'x' })).toThrow(/type/);
  });

  it('throws if invalidAt before validAt', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'x',
        validAt: new Date('2026-06-01'),
        invalidAt: new Date('2026-05-01'),
      }),
    ).toThrow(/validAt.*invalidAt/);
  });

  it('throws if importance out of [1, 10]', () => {
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 0 }),
    ).toThrow(/importance/);
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 11 }),
    ).toThrow(/importance/);
  });

  it('passes importance in range', () => {
    for (let i = 1; i <= 10; i++) {
      expect(() =>
        validateEventInput({ type: 'event', content: 'x', importance: i }),
      ).not.toThrow();
    }
  });
});
