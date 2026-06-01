import { describe, it, expect } from 'vitest';
import { parseFinanceResponse, buildFinancePending } from './finance-vision.js';

describe('parseFinanceResponse — defensive', () => {
  it('expense from a clean JSON', () => {
    const r = parseFinanceResponse('{"direction":"expense","amount":3000,"category":"food","merchant":"Magnum","date":"2026-06-01","confidence":0.9}');
    expect(r.direction).toBe('expense');
    expect(r.amount).toBe(3000);
    expect(r.merchant).toBe('Magnum');
  });
  it('income', () => {
    const r = parseFinanceResponse('```json\n{"direction":"income","amount":350000,"merchant":"Зарплата","confidence":0.8}\n```');
    expect(r.direction).toBe('income');
    expect(r.amount).toBe(350000);
  });
  it('garbage JSON → unknown, amount null', () => {
    const r = parseFinanceResponse('не вижу чека, извините');
    expect(r.direction).toBe('unknown');
    expect(r.amount).toBeNull();
  });
  it('direction present but no amount → unknown', () => {
    const r = parseFinanceResponse('{"direction":"expense","amount":0}');
    expect(r.direction).toBe('unknown');
    expect(r.amount).toBeNull();
  });
});

describe('buildFinancePending — pure mapping', () => {
  it('expense → add_expense action + confirm text', () => {
    const p = buildFinancePending({ direction: 'expense', amount: 3000, category: 'food', merchant: 'Magnum', confidence: 0.9 });
    expect(p?.action).toBe('add_expense');
    expect(p?.input).toMatchObject({ amount: 3000 });
    expect(p?.confirmationText).toMatch(/Записать расход 3000/);
  });
  it('income → add_income action', () => {
    const p = buildFinancePending({ direction: 'income', amount: 350000, merchant: 'Зарплата', confidence: 0.8 });
    expect(p?.action).toBe('add_income');
    expect(p?.input).toMatchObject({ amount: 350000, source: 'Зарплата' });
  });
  it('unknown → null (no pending)', () => {
    expect(buildFinancePending({ direction: 'unknown', amount: null, confidence: 0 })).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/services/finance-vision.ts'), 'utf8');
describe('analyzeFinancePhoto — structure', () => {
  it('uses createAnthropic + sonnet vision + image content block, never throws', () => {
    expect(SRC).toMatch(/createAnthropic\(\)/);
    expect(SRC).toMatch(/MODELS\.sonnet/);
    expect(SRC).toMatch(/type: 'image'/);
    expect(SRC).toMatch(/catch \(err\)/);
  });
});
