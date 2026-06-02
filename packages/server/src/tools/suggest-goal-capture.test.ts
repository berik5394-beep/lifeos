import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestGoalTool } from './suggest-goal.js';

const SRC = readFileSync(join(process.cwd(), 'src/tools/suggest-goal.ts'), 'utf-8');

describe('suggest_goal — предложитель цели (target/targetDate + ask-before-write)', () => {
  it('схема принимает target/targetDate/goalId (опц.)', () => {
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'finance',
        goalText: 'накопить 100к',
        rationale: 'хочет подушку',
        target: 100000,
        targetDate: 'к концу месяца',
        goalId: 'g1',
      }),
    ).not.toThrow();
  });

  it('старая форма (без новых полей) всё ещё валидна', () => {
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'health',
        goalText: 'бегать 3х в неделю',
        rationale: 'форма',
      }),
    ).not.toThrow();
  });

  it('агент-вызываемый (needsConfirm:false) → достижим из чата', () => {
    expect(suggestGoalTool.needsConfirm).toBe(false);
  });

  it('предлагает (pending commit_goal + вопрос), резолвит срок для превью', () => {
    expect(SRC).toContain('setPendingAction');
    expect(SRC).toContain("'commit_goal'");
    expect(SRC).toContain('parseGoalDeadline'); // превью относительного срока
    expect(SRC).toMatch(/Зафиксировать цель/); // дружеский вопрос
  });

  it('aliases несут сумму/срок (amount/sum→target, deadline→targetDate)', () => {
    expect(suggestGoalTool.aliases?.amount).toBe('target');
    expect(suggestGoalTool.aliases?.sum).toBe('target');
    expect(suggestGoalTool.aliases?.deadline).toBe('targetDate');
  });
});
