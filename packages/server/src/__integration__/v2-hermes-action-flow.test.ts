import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const RUNNER = readFileSync(join(process.cwd(), 'src/services/hermes/skill-runner.ts'), 'utf-8');

describe('v2 H2 action-skill flow', () => {
  it('action skills route to the deterministic runner; read skills keep the seed', () => {
    expect(ORCH).toContain('runSkillPlan');
    expect(ORCH).toContain('buildSkillInstruction'); // read/write path still present
    expect(ORCH).toContain('skillReply');
  });
  it('money steps batch into a run_skill_actions PendingAction (no auto-exec)', () => {
    expect(RUNNER).toMatch(/run_skill_actions/);
    expect(RUNNER).toMatch(/setPendingAction/);
    expect(RUNNER).toMatch(/runRegistryTool/);
  });
  it('confirm execution loops runRegistryTool in runConfirmedAction', () => {
    expect(ORCH).toMatch(/action === 'run_skill_actions'/);
    expect(ORCH).toMatch(/runRegistryTool\(s\.toolName, s\.args/);
  });
});
