import { describe, it, expect } from 'vitest';
import {
  computeCategoryImpact,
  computeObligationImpact,
  pickTopCategory,
  describeGoalImpact,
} from './types.js';

describe('goal-impact/types', () => {
  it('computeCategoryImpact: доля = трата/requiredMonthly; req<=0 → null', () => {
    expect(computeCategoryImpact(34000, 85000)?.share).toBeCloseTo(0.4, 2);
    expect(computeCategoryImpact(34000, 0)).toBeNull();
    expect(computeCategoryImpact(34000, -5)).toBeNull();
  });
  it('computeObligationImpact: monthsDelay = долг/req; req<=0 → null', () => {
    expect(computeObligationImpact(500000, 100000)?.monthsDelay).toBeCloseTo(5, 5);
    expect(computeObligationImpact(500000, 0)).toBeNull();
  });
  it('pickTopCategory: запись с max amount или null', () => {
    expect(
      pickTopCategory([
        { category: 'food', amount: 12000 },
        { category: 'transport', amount: 34000 },
      ]),
    ).toEqual({ category: 'transport', amount: 34000 });
    expect(pickTopCategory([])).toBeNull();
  });
  it('describeGoalImpact: строка с числами; null если нечего сказать', () => {
    const s = describeGoalImpact(
      'миллион',
      85000,
      { category: 'food', amount: 34000 },
      500000,
    );
    expect(s).toContain('миллион');
    expect(s).toContain('40%');
    expect(describeGoalImpact('миллион', 85000, null, 0)).toBeNull();
  });
});
