import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('M1 DELETE-роуты → *_deleted захват (cuttable)', () => {
  it('tasks: task_deleted', () => {
    expect(read('tasks.ts')).toMatch(/type:\s*'task_deleted'/);
  });
  it('habits: habit_deleted', () => {
    expect(read('habits.ts')).toMatch(/type:\s*'habit_deleted'/);
  });
  it('finance: expense_deleted + income_deleted', () => {
    const s = read('finance.ts');
    expect(s).toMatch(/type:\s*'expense_deleted'/);
    expect(s).toMatch(/type:\s*'income_deleted'/);
  });
  it('goals: weekly_goal_deleted + yearly_goal_deleted', () => {
    const s = read('goals.ts');
    expect(s).toMatch(/type:\s*'weekly_goal_deleted'/);
    expect(s).toMatch(/type:\s*'yearly_goal_deleted'/);
  });
  it('events: event_deleted', () => {
    expect(read('events.ts')).toMatch(/type:\s*'event_deleted'/);
  });
});
