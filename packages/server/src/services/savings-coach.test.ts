import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldNudgeOnExpense } from './savings-coach.js';

const base = {
  status: 'anchor_at_risk' as const,
  monthToDateExpense: 0,
  monthlyIncome: 500_000,
  requiredAnchor: 250_000, // goalBudget = 250_000
  expenseAmount: 1000,
  alreadyCoachedToday: false,
};

describe('shouldNudgeOnExpense — гейт «бьёт по главной цели»', () => {
  it('молчит если уже советовали сегодня', () => {
    expect(shouldNudgeOnExpense({ ...base, alreadyCoachedToday: true, monthToDateExpense: 999_999 })).toBe(false);
  });
  it('молчит если статус не anchor_at_risk/collision/stalled', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'on_track_all' })).toBe(false);
    expect(shouldNudgeOnExpense({ ...base, status: 'none' })).toBe(false);
  });
  it('говорит когда траты месяца превысили бюджет под главную', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 300_000 })).toBe(true); // >250k
  });
  it('говорит на крупную разовую трату (>=10% дохода)', () => {
    expect(shouldNudgeOnExpense({ ...base, expenseAmount: 60_000 })).toBe(true); // 12% от 500k
  });
  it('молчит на обычную трату в рамках бюджета', () => {
    expect(shouldNudgeOnExpense({ ...base, monthToDateExpense: 100_000, expenseAmount: 1000 })).toBe(false);
  });
  it('collision тоже триггерит (при превышении бюджета)', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'collision', monthToDateExpense: 300_000 })).toBe(true);
  });
  it('stalled тоже триггерит', () => {
    expect(shouldNudgeOnExpense({ ...base, status: 'stalled', monthToDateExpense: 300_000 })).toBe(true);
  });
});

describe('maybeSavingsCoachLine — структурно на portfolio', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/savings-coach.ts'), 'utf-8');
  it('зовёт computePortfolioPace + describePortfolioPace', () => {
    expect(src).toContain('computePortfolioPace');
    expect(src).toContain('describePortfolioPace');
  });
  it('гейт по requiredAnchor (не requiredMonthly)', () => {
    expect(src).toContain('requiredAnchor');
    expect(src).not.toContain('requiredMonthly');
  });
});
