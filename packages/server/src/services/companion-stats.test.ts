import { describe, it, expect } from 'vitest';
import { companionLine } from './companion-stats.js';

describe('J: строка «друга» в сводке', () => {
  it('пусто — нет строки; есть — кратко', () => {
    expect(companionLine({ offered: 0, asked: 0, answered: 0, milestones: 0, diaries: 0, checkIns: 0 })).toBeNull();
    expect(companionLine({ offered: 5, asked: 3, answered: 2, milestones: 1, diaries: 7, checkIns: 4 })).toBe(
      'Друг: «как прошло?» спросил 3 из 5 предложенных, ответили 2, круглых дат отметил 1, записей дневника 7, пушей «как ты?» 4.',
    );
  });
});
