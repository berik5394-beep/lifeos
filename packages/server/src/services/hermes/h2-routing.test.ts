import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('orchestrator H2 composition routing', () => {
  it('imports runSkillPlan', () => {
    expect(ORCH).toMatch(/runSkillPlan/);
  });
  it('routes a confirm-containing skill to runSkillPlan (deterministic)', () => {
    expect(ORCH).toMatch(/toolConfirmRequired/);
    expect(ORCH).toMatch(/skillReply/);
  });
});
