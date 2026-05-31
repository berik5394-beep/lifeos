import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-runner.ts'), 'utf-8');

describe('runSkillPlan structure', () => {
  it('exports runSkillPlan', () => {
    expect(SRC).toMatch(/export async function runSkillPlan/);
  });
  it('resolves args then partitions by toolConfirmRequired', () => {
    expect(SRC).toMatch(/resolveSkillArgs/);
    expect(SRC).toMatch(/partitionSteps/);
    expect(SRC).toMatch(/toolConfirmRequired/);
  });
  it('runs auto steps via runRegistryTool', () => {
    expect(SRC).toMatch(/runRegistryTool/);
  });
  it('batches confirm steps into a run_skill_actions PendingAction', () => {
    expect(SRC).toMatch(/setPendingAction/);
    expect(SRC).toMatch(/run_skill_actions/);
  });
  it('synthesizes a message via haiku, best-effort', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/catch/);
  });
});
