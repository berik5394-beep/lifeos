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
    expect(p?.input).toMatchObject({ amount: 3000, category: 'food', description: 'Magnum' });
    expect(p?.confirmationText.replace(/\u00a0/g, ' ')).toBe('С чека: 3 000 ₸ · «Magnum» · Еда. Записать трату? Скажи «да» — запишу, или поправь: «3500 на еду».');
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

import { cleanMerchant } from './finance-vision.js';
describe('текст с фото — не доверенный', () => {
  it('вычищаем разметку/команды-символы, режем до 60', () => {
    expect(cleanMerchant('ТОО «Magnum» <script>alert(1)</script>')).toBe('ТОО «Magnum» script alert(1) script');
    expect(cleanMerchant('a'.repeat(100))?.length).toBe(60);
    expect(cleanMerchant(42)).toBeUndefined();
    expect(cleanMerchant('  ')).toBeUndefined();
  });
  it('сумма больше разумного предела → не читаем', () => {
    expect(parseFinanceResponse('{"direction":"expense","amount":99999999999}').amount).toBeNull();
  });
  it('дата только YYYY-MM-DD', () => {
    expect(parseFinanceResponse('{"direction":"expense","amount":5,"date":"вчера"}').date).toBeUndefined();
  });
});

import { realDate } from './finance-vision.js';
describe('дата с чека', () => {
  it('несуществующая дата («2026-25-10», 31 февраля) — отбрасываем, не роняем запрос', () => {
    expect(realDate('2026-25-10')).toBeUndefined();
    expect(realDate('2026-02-31')).toBeUndefined();
    expect(realDate('2026-11-07')).toBe('2026-11-07');
  });
  it('дата вне окна (будущее / старше 2 мес.) — в вопросе не обещаем', () => {
    const today = new Date('2026-11-08T00:00:00Z');
    const fut = buildFinancePending({ direction: 'expense', amount: 100, date: '2026-12-01', confidence: 1 }, today);
    expect(fut?.input.date).toBeUndefined();
    expect(fut?.confirmationText).not.toContain('01.12');
    const ok = buildFinancePending({ direction: 'expense', amount: 100, date: '2026-11-07', confidence: 1 }, today);
    expect(ok?.input.date).toBe('2026-11-07');
    expect(ok?.confirmationText).toContain('за 07.11');
  });
  it('доход — без даты в вопросе (пишется сегодняшним)', () => {
    const r = buildFinancePending({ direction: 'income', amount: 5000, date: '2026-11-07', confidence: 1 }, new Date('2026-11-08T00:00:00Z'));
    expect(r?.confirmationText).not.toContain('07.11');
  });
});
