import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/routes/goals.ts'), 'utf-8');

describe('routes/goals — хук оценки недельной цели', () => {
  it('POST /goals/weekly запускает фоновую оценку', () => {
    expect(SRC).toContain('estimateWeeklyGoalMinutesInBackground');
    expect(SRC).toMatch(/void estimateWeeklyGoalMinutesInBackground\(/);
  });
});
