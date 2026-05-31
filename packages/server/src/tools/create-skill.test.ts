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
  it('needs confirmation (write to a saved skill)', () => {
    expect(SRC).toMatch(/needsConfirm:\s*true/);
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
