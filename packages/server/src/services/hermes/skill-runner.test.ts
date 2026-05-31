import { describe, it, expect } from 'vitest';
import { partitionSteps } from './skill-runner.js';

const needsConfirmOf = (toolName: string): boolean =>
  toolName === 'add-expense' || toolName === 'add-income';

describe('partitionSteps (pure)', () => {
  it('splits auto vs confirm preserving order', () => {
    const plan = [
      { toolName: 'get-tasks' },
      { toolName: 'add-expense' },
      { toolName: 'complete-habit' },
      { toolName: 'add-income' },
    ];
    const args = [{}, { amount: 3000 }, {}, { amount: 500 }];
    const { auto, confirm } = partitionSteps(plan, args, needsConfirmOf);
    expect(auto.map((s) => s.toolName)).toEqual(['get-tasks', 'complete-habit']);
    expect(confirm.map((s) => s.toolName)).toEqual(['add-expense', 'add-income']);
    expect(confirm[0].args).toEqual({ amount: 3000 });
  });
  it('all-auto → empty confirm', () => {
    const plan = [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }];
    const { auto, confirm } = partitionSteps(plan, [{}, {}], needsConfirmOf);
    expect(auto).toHaveLength(2);
    expect(confirm).toHaveLength(0);
  });
  it('all-confirm → empty auto', () => {
    const plan = [{ toolName: 'add-expense' }];
    const { auto, confirm } = partitionSteps(plan, [{ amount: 1 }], needsConfirmOf);
    expect(auto).toHaveLength(0);
    expect(confirm).toHaveLength(1);
  });
  it('pairs each step with its args by index (missing → {})', () => {
    const plan = [{ toolName: 'add-expense' }];
    const { confirm } = partitionSteps(plan, [], needsConfirmOf);
    expect(confirm[0].args).toEqual({});
  });
});
