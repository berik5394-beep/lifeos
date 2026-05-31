import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('runConfirmedAction run_skill_actions branch', () => {
  it("handles action === 'run_skill_actions'", () => {
    expect(ORCH).toMatch(/action === 'run_skill_actions'/);
  });
  it('loops the batched steps through runRegistryTool', () => {
    expect(ORCH).toMatch(/for \(const s of steps\)/);
    expect(ORCH).toMatch(/runRegistryTool\(s\.toolName, s\.args/);
  });
});
