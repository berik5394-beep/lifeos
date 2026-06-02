import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestGoalTool } from './suggest-goal.js';

const SRC = readFileSync(join(__dirname, 'suggest-goal.ts'), 'utf8');

describe('suggestGoalTool — shape', () => {
  it('needsConfirm: false (agent-callable — обратимая не-денежная запись)', () => {
    expect(suggestGoalTool.name).toBe('suggest_goal');
    // FALSE → агент видит и вызывает напрямую (как create_task). Иначе
    // suggest_goal недостижим из чата (фильтр agentToolSchemasForUser).
    expect(suggestGoalTool.needsConfirm).toBe(false);
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
  it('handler ПРЕДЛАГАЕТ (ставит pending commit_goal), НЕ пишет напрямую', () => {
    expect(SRC).toContain('setPendingAction');
    expect(SRC).toContain("'commit_goal'");
    // Реальная запись — в commitGoal (на «да»), не в самом инструменте.
    expect(SRC).not.toMatch(/prisma\.yearlyGoal\.(create|update)/);
  });
});
