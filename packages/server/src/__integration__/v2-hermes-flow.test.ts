import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const RUNNER = readFileSync(join(process.cwd(), 'src/services/hermes/types.ts'), 'utf-8');
const IMPL = readFileSync(join(process.cwd(), 'src/services/hermes/postgres-impl.ts'), 'utf-8');
const TOOL = readFileSync(join(process.cwd(), 'src/tools/create-skill.ts'), 'utf-8');

describe('v2 hermes flow — run via existing agent loop', () => {
  it('orchestrator seeds the skill instruction, gated by the flag', () => {
    expect(ORCH).toContain('isV2HermesEnabled');
    expect(ORCH).toContain('routeToSkill');
    expect(ORCH).toContain('buildSkillInstruction');
  });
  it('skill execution is seed-only — no direct tool handler dispatch in hermes', () => {
    expect(RUNNER).not.toMatch(/\.handler\(/);
  });
});

describe('v2 hermes flow — safety', () => {
  it('createSkill validates against the live registry + blocklist', () => {
    expect(IMPL).toMatch(/validateSkillTools/);
  });
  it('explicit creation tool is agent-reachable (needsConfirm:false)', () => {
    // Save = non-money reversible write; needsConfirm:true would hide it
    // from the agent loop. Money safety stays at RUN time + create-blocklist.
    expect(TOOL).toMatch(/needsConfirm:\s*false/);
  });
});
