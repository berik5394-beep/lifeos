import { describe, it, expect } from 'vitest';
import { expenseRemark, savingGoalFrom } from './money-voice.js';

/** Характер в подтверждении траты (2026-11-10): фраза в стиле, только из слов человека. */
describe('money-voice', () => {
  it('цель накопления из слов человека', () => {
    expect(savingGoalFrom('Я потратил 15000 на кроссовки, хотя копил на отпуск')).toBe('отпуск');
    expect(savingGoalFrom('коплю на машину. потратил 5000')).toBe('машину');
    expect(savingGoalFrom('потратил 3000 на продукты')).toBeNull();
  });
  it('жалеет о трате — фраза про цель в каждом стиле, разная', () => {
    const t = 'Я потратил 15000 на кроссовки, хотя копил на отпуск';
    const lines = (['friendly', 'strict', 'calm', 'toxic'] as const).map((s) => expenseRemark(s, t, 15000));
    for (const l of lines) expect(l).toContain('«отпуск»');
    expect(new Set(lines).size).toBe(4);
  });
  it('обычная трата — короткая фраза в стиле; без чисел и лимитов (ничего не выдумываем)', () => {
    for (const s of ['friendly', 'strict', 'calm', 'toxic', null, 'unknown']) {
      const l = expenseRemark(s, 'Потратил 3000 на продукты', 3000);
      expect(l.length).toBeGreaterThan(10);
      expect(l).not.toMatch(/\d/);
    }
  });
});
