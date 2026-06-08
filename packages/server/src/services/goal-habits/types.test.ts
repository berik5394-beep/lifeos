import { describe, it, expect } from 'vitest';
import { computeStall, pickWorstStall, formatStallText, type GoalHabitHealth } from './types.js';

const row = (over: Partial<GoalHabitHealth>): GoalHabitHealth => ({
  goalId: 'g', goalText: 'Быть в форме', linkedHabitCount: 2, daysSinceLastCompletion: 0, ...over,
});

describe('computeStall', () => {
  it('≥3 дней без отметок при наличии привычек → stall', () => {
    expect(computeStall([row({ daysSinceLastCompletion: 4 })], 3)).toHaveLength(1);
  });
  it('свежая отметка → не stall', () => {
    expect(computeStall([row({ daysSinceLastCompletion: 1 })], 3)).toHaveLength(0);
  });
  it('нет привычек к цели → не stall', () => {
    expect(computeStall([row({ linkedHabitCount: 0, daysSinceLastCompletion: 10 })], 3)).toHaveLength(0);
  });
});

describe('pickWorstStall', () => {
  it('берёт максимум daysSince', () => {
    const w = pickWorstStall([row({ goalId: 'a', daysSinceLastCompletion: 4 }), row({ goalId: 'b', daysSinceLastCompletion: 9 })]);
    expect(w?.goalId).toBe('b');
  });
  it('пусто → null', () => { expect(pickWorstStall([])).toBeNull(); });
  it('#4: «ни разу» (null) ранжируется как худший — выше любого N дней', () => {
    const w = pickWorstStall([row({ goalId: 'a', daysSinceLastCompletion: 40 }), row({ goalId: 'b', daysSinceLastCompletion: null })]);
    expect(w?.goalId).toBe('b');
  });
});

describe('#4 честность — null = «ни разу», без фейковых 9999', () => {
  it('computeStall флагует никогда-не-отмеченную цель (null)', () => {
    expect(computeStall([row({ daysSinceLastCompletion: null })], 3)).toHaveLength(1);
  });
  it('formatStallText(null) → честное «ещё ни разу», без числа', () => {
    const t = formatStallText(row({ goalText: 'Быть в форме', daysSinceLastCompletion: null }));
    expect(t).toContain('ещё ни разу');
    expect(t).not.toMatch(/\d/); // никаких «9999 дн»
  });
  it('formatStallText(N) → «N дн без отметок»', () => {
    expect(formatStallText(row({ goalText: 'Цель', daysSinceLastCompletion: 7 }))).toBe('«Цель» — 7 дн без отметок');
  });
});
