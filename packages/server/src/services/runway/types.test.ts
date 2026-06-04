import { describe, it, expect } from 'vitest';
import { computeRunway, describeRunway } from './types.js';

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
