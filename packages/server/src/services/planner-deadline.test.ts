import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/planner-service.ts'), 'utf-8');

describe('planner пишет targetDate из текста цели', () => {
  it('импортирует parseGoalDeadline', () => {
    expect(SRC).toContain("import { parseGoalDeadline }");
  });
  it('кладёт targetDate в yearlyGoal.update патч', () => {
    expect(SRC).toMatch(/targetDate:\s*parseGoalDeadline/);
  });
});
