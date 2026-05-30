import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestGoalTool } from './suggest-goal.js';

const SRC = readFileSync(join(__dirname, 'suggest-goal.ts'), 'utf8');

describe('suggestGoalTool — shape', () => {
  it('needsConfirm: true (creates YearlyGoal)', () => {
    expect(suggestGoalTool.name).toBe('suggest_goal');
    expect(suggestGoalTool.needsConfirm).toBe(true);
    expect(suggestGoalTool.sideEffects).toBe('write');
  });
  it('schema enforces area enum + rationale required', () => {
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'health',
        goalText: 'бегать 3х в неделю',
        rationale: 'обсуждали что хочешь форму',
      }),
    ).not.toThrow();
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'love', // invalid
        goalText: 'x',
        rationale: 'y',
      }),
    ).toThrow();
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'health',
        goalText: 'x',
      }),
    ).toThrow();
  });
  it('handler creates YearlyGoal via prisma', () => {
    expect(SRC).toMatch(/prisma\.yearlyGoal\.create/);
  });
});
