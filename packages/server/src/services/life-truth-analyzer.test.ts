import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSavingsRate } from './life-truth-analyzer.js';

const SRC = readFileSync(join(__dirname, 'life-truth-analyzer.ts'), 'utf8');

describe('formatSavingsRate — #1 честность (без сентинела -100)', () => {
  it('null (нет дохода) → «нет данных о доходе», без процента/числа', () => {
    expect(formatSavingsRate(null)).toBe('нет данных о доходе');
  });
  it('реальное число → «N%»', () => {
    expect(formatSavingsRate(35)).toBe('35%');
    expect(formatSavingsRate(-12)).toBe('-12%'); // настоящий дефицит (доход>0) — показываем честно
  });
});

describe('#1 структурный гард — сентинел -100 удалён, рендер через formatSavingsRate', () => {
  it('savingsRate при нуле дохода = null, НЕ -100', () => {
    expect(SRC).toMatch(/monthlyIncome > 0[\s\S]{0,120}:\s*null;/);
    expect(SRC).not.toMatch(/:\s*-100;/);
  });
  it('оба промпта рендерят savingsRate через formatSavingsRate', () => {
    const renders = SRC.match(/formatSavingsRate\(financial\.savingsRate\)/g) ?? [];
    expect(renders.length).toBeGreaterThanOrEqual(2);
  });
  it('daysUntilBroke считается только при доходе>0 (нет «0 дней» без дохода)', () => {
    expect(SRC).toMatch(/monthlyIncome > 0 && monthlySavings < 0/);
  });
});
