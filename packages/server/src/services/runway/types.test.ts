import { describe, it, expect } from 'vitest';
import { computeRunway, describeRunway, computeAnchoredCash } from './types.js';

describe('runway/types', () => {
  it('no_data: нет транзакций', () => {
    const r = computeRunway({ cashOnHand: 0, monthlyIncome: 0, monthlyBurn: 0 });
    expect(r.status).toBe('no_data');
    expect(r.runwayMonths).toBeNull();
  });
  it('cash_positive: доход ≥ расход', () => {
    const r = computeRunway({ cashOnHand: 100000, monthlyIncome: 300000, monthlyBurn: 200000 });
    expect(r.status).toBe('cash_positive');
    expect(r.runwayMonths).toBeNull();
    expect(r.netBurnRate).toBe(-100000);
  });
  it('underwater: накоплен минус при чистом расходе', () => {
    const r = computeRunway({ cashOnHand: -5000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(r.status).toBe('underwater');
    expect(r.runwayMonths).toBe(0);
  });
  it('critical: < 1 мес', () => {
    const r = computeRunway({ cashOnHand: 40000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(r.netBurnRate).toBe(50000);
    expect(r.runwayMonths).toBeCloseTo(0.8, 2);
    expect(r.status).toBe('critical');
  });
  it('short: < 3 мес', () => {
    const r = computeRunway({ cashOnHand: 100000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(r.runwayMonths).toBeCloseTo(2, 5);
    expect(r.status).toBe('short');
  });
  it('healthy: ≥ 3 мес', () => {
    const r = computeRunway({ cashOnHand: 600000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(r.status).toBe('healthy');
  });

  it('describeRunway: строка для short/critical/underwater', () => {
    const short = computeRunway({ cashOnHand: 100000, monthlyIncome: 100000, monthlyBurn: 150000 });
    const s = describeRunway(short, 100000);
    expect(s).toContain('2');
    expect(s).toContain('мес');
    const uw = computeRunway({ cashOnHand: -5000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(describeRunway(uw, -5000)).toContain('минус');
  });
  it('describeRunway: null для healthy/cash_positive/no_data', () => {
    const healthy = computeRunway({ cashOnHand: 600000, monthlyIncome: 100000, monthlyBurn: 150000 });
    expect(describeRunway(healthy, 600000)).toBeNull();
    const pos = computeRunway({ cashOnHand: 100000, monthlyIncome: 300000, monthlyBurn: 200000 });
    expect(describeRunway(pos, 100000)).toBeNull();
    const nd = computeRunway({ cashOnHand: 0, monthlyIncome: 0, monthlyBurn: 0 });
    expect(describeRunway(nd, 0)).toBeNull();
  });
});

describe('computeAnchoredCash', () => {
  it('balance − expensesSince + incomesSince', () => {
    expect(
      computeAnchoredCash({ balance: 500_000, expensesSince: 120_000, incomesSince: 0 }),
    ).toBe(380_000);
  });
  it('no expenses → balance unchanged', () => {
    expect(
      computeAnchoredCash({ balance: 500_000, expensesSince: 0, incomesSince: 0 }),
    ).toBe(500_000);
  });
  it('income since snapshot extends cash', () => {
    expect(
      computeAnchoredCash({ balance: 100_000, expensesSince: 30_000, incomesSince: 350_000 }),
    ).toBe(420_000);
  });
  it('expenses exceed balance → negative (underwater)', () => {
    expect(
      computeAnchoredCash({ balance: 50_000, expensesSince: 90_000, incomesSince: 0 }),
    ).toBe(-40_000);
  });
});

describe('describeRunway — hasAnchor', () => {
  it('healthy + hasAnchor → positive non-null string', () => {
    const r = { netBurnRate: 50_000, runwayMonths: 6, status: 'healthy' as const };
    const s = describeRunway(r, 300_000, { hasAnchor: true, monthlyIncome: 200_000 });
    expect(s).toBeTruthy();
    expect(s).toMatch(/6 мес/);
  });
  it('healthy WITHOUT anchor → null (silent-when-healthy preserved)', () => {
    const r = { netBurnRate: 50_000, runwayMonths: 6, status: 'healthy' as const };
    expect(describeRunway(r, 300_000)).toBeNull();
  });
  it('cash_positive + hasAnchor → positive string (no months)', () => {
    const r = { netBurnRate: -10_000, runwayMonths: null, status: 'cash_positive' as const };
    const s = describeRunway(r, 300_000, { hasAnchor: true, monthlyIncome: 400_000 });
    expect(s).toBeTruthy();
  });
  it('cash_positive + hasAnchor + negative cash → no contradictory «держится» line', () => {
    const r = { netBurnRate: -10_000, runwayMonths: null, status: 'cash_positive' as const };
    const s = describeRunway(r, -50_000, { hasAnchor: true, monthlyIncome: 400_000 });
    expect(s).toBeTruthy();
    expect(s).not.toMatch(/держится/);
    expect(s).not.toMatch(/-50000/);
  });
  it('income tail appended when monthlyIncome<=0 and hasAnchor', () => {
    const r = { netBurnRate: 80_000, runwayMonths: 2, status: 'short' as const };
    const s = describeRunway(r, 160_000, { hasAnchor: true, monthlyIncome: 0 });
    expect(s).toMatch(/записывай зарплату/);
  });
  it('no income tail when income known', () => {
    const r = { netBurnRate: 80_000, runwayMonths: 2, status: 'short' as const };
    const s = describeRunway(r, 160_000, { hasAnchor: true, monthlyIncome: 200_000 });
    expect(s).not.toMatch(/записывай зарплату/);
  });
});
