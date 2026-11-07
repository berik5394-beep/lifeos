import { describe, it, expect } from 'vitest';
import { numbersHonest } from './number-honesty.js';

describe('гард чисел', () => {
  it('числа из фактов (в т.ч. с разделителями тысяч) — честно', () => {
    expect(numbersHonest('Потратил 85 000 из 100 000 ₸', 'потрачено 85 000 из 100 000 ₸ (85%)')).toBe(true);
  });
  it('выдуманное число — нечестно', () => {
    expect(numbersHonest('У тебя 7 задач', 'задач на сегодня: 3')).toBe(false);
  });
  it('без чисел — честно', () => {
    expect(numbersHonest('Как ты сегодня?', '')).toBe(true);
  });
});
