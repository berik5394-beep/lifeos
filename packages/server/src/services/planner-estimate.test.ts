import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/planner-service.ts'), 'utf-8');

describe('planner-service — оценка недельных целей после persistPlan', () => {
  it('собирает созданные строки и запускает фоновую оценку после транзакции', () => {
    expect(SRC).toContain('estimateWeeklyGoalMinutesInBackground');
    expect(SRC).toContain('createdWeeklyGoals');
    expect(SRC).toMatch(/void estimateWeeklyGoalMinutesInBackground\(/);
  });
});
