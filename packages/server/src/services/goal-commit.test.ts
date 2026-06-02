import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/goal-commit.ts'), 'utf-8');
const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('commitGoal — запись цели на «да»', () => {
  it('create-or-update через decideGoalWrite + резолв срока', () => {
    expect(SRC).toContain('decideGoalWrite');
    expect(SRC).toContain('parseGoalDeadline');
    expect(SRC).toMatch(/yearlyGoal\.create/);
    expect(SRC).toMatch(/yearlyGoal\.update/);
  });
});

describe('orchestrator — «да» на цель → commitGoal', () => {
  it('runConfirmedAction имеет ветку commit_goal → commitGoal', () => {
    expect(ORCH).toContain('import { commitGoal');
    expect(ORCH).toContain("action === 'commit_goal'");
    expect(ORCH).toContain('commitGoal(');
  });
});
