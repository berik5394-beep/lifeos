import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestGoalTool } from './suggest-goal.js';

const SRC = readFileSync(join(process.cwd(), 'src/tools/suggest-goal.ts'), 'utf-8');

describe('suggest_goal — единый захват цели (target/targetDate + create-or-update)', () => {
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

  it('хендлер: create-or-update за флагом + резолв срока', () => {
    expect(SRC).toContain('isV2SavingsCoachEnabled');
    expect(SRC).toContain('decideGoalWrite');
    expect(SRC).toContain('parseGoalDeadline');
    expect(SRC).toContain('yearlyGoal.update');
  });

  it('флаг off → старое поведение (always create) раньше update-ветки', () => {
    const iFlag = SRC.indexOf('if (!isV2SavingsCoachEnabled');
    const iCreate = SRC.indexOf('yearlyGoal.create', iFlag);
    const iUpdate = SRC.indexOf('yearlyGoal.update');
    expect(iFlag).toBeGreaterThan(-1);
    expect(iCreate).toBeGreaterThan(iFlag); // create в off-ветке
    expect(iCreate).toBeLessThan(iUpdate); // off-create раньше on-update
  });

  it('aliases несут сумму/срок (amount/sum→target, deadline→targetDate)', () => {
    expect(suggestGoalTool.aliases?.amount).toBe('target');
    expect(suggestGoalTool.aliases?.sum).toBe('target');
    expect(suggestGoalTool.aliases?.deadline).toBe('targetDate');
  });
});
