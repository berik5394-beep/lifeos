import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/tools/create-skill.ts'), 'utf-8');
const IDX = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');

describe('create-skill tool', () => {
  it('exports createSkillTool', () => {
    expect(SRC).toMatch(/export const createSkillTool/);
  });
  it('is agent-reachable: needsConfirm false (non-money write, like create-task)', () => {
    // needsConfirm:true would exclude it from agentToolSchemasForUser →
    // the agent could never call it → create_skill would be a dead tool.
    expect(SRC).toMatch(/needsConfirm:\s*false/);
  });
  it('category system', () => {
    expect(SRC).toMatch(/category:\s*'system'/);
  });
  it('drafts via buildSkillFromRequest then createSkill', () => {
    expect(SRC).toMatch(/buildSkillFromRequest/);
    expect(SRC).toMatch(/createSkill/);
  });
  it('is registered in ALL_TOOLS', () => {
    expect(IDX).toMatch(/createSkillTool/);
  });
});
