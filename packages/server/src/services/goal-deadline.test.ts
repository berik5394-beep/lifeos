import { describe, it, expect } from 'vitest';
import { parseGoalDeadline } from './goal-deadline.js';

const NOW = new Date('2026-06-01T00:00:00Z');

describe('parseGoalDeadline', () => {
  it('«к декабрю» → 31 дек текущего года', () => {
    const d = parseGoalDeadline('накопить 3 млн к декабрю', NOW)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // декабрь
    expect(d.getDate()).toBe(31);
  });
  it('«к концу года» → 31 дек', () => {
    const d = parseGoalDeadline('накопить миллион к концу года', NOW)!;
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
  it('«к концу месяца» → последний день текущего месяца (фраза SMOKE)', () => {
    const d = parseGoalDeadline('накопить 100000 к концу месяца', NOW)!;
    expect(d.getMonth()).toBe(5); // июнь (NOW = 2026-06-01)
    expect(d.getDate()).toBe(30); // 30 июня
  });
  it('«до июня 2027» → 30 июня 2027', () => {
    const d = parseGoalDeadline('отложить на машину до июня 2027', NOW)!;
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(5); // июнь
    expect(d.getDate()).toBe(30);
  });
  it('нет даты → null', () => {
    expect(parseGoalDeadline('накопить 3 млн', NOW)).toBeNull();
  });
});
