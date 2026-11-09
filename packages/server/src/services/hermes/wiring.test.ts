import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('orchestrator hermes run-seed', () => {
  it('без флага (isV2HermesEnabled удалён)', () => {
    expect(ORCH).not.toMatch(/isV2HermesEnabled/);
  });
  it('routes to a skill and seeds the system prompt', () => {
    expect(ORCH).toMatch(/routeToSkill/);
    expect(ORCH).toMatch(/buildSkillInstruction/);
    expect(ORCH).toMatch(/bumpUsage/);
  });
});
