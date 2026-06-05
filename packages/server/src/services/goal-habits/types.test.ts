import { describe, it, expect } from 'vitest';
import { computeStall, pickWorstStall, type GoalHabitHealth } from './types.js';

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
});
