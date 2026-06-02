import { describe, it, expect } from 'vitest';
import { shouldNudgeOnExpense } from './savings-coach.js';

const base = {
  status: 'behind' as const,
  monthToDateExpense: 0,
  monthlyIncome: 500_000,
  requiredMonthly: 250_000, // goalBudget = 250_000
  expenseAmount: 1000,
  alreadyCoachedToday: false,
};

describe('shouldNudgeOnExpense — гейт «бьёт по цели»', () => {
  it('молчит если уже советовали сегодня', () => {
    expect(shouldNudgeOnExpense({ ...base, alreadyCoachedToday: true, monthToDateExpense: 999_999 })).toBe(false);
  });
  it('молчит если статус не behind/stalled', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'on_track' })).toBe(false);
  });
  it('говорит когда траты месяца превысили бюджет под цель', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 300_000 })).toBe(true); // >250k
  });
  it('говорит на крупную разовую трату (>=10% дохода)', () => {
    expect(shouldNudgeOnExpense({ ...base, expenseAmount: 60_000 })).toBe(true); // 12% от 500k
  });
  it('молчит на обычную трату в рамках бюджета', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 100_000, expenseAmount: 1000 })).toBe(false);
  });
  it('stalled тоже триггерит (при превышении бюджета)', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'stalled', monthToDateExpense: 300_000 })).toBe(true);
  });
});
