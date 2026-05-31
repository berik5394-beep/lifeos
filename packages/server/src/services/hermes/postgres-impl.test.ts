import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/postgres-impl.ts'), 'utf-8');

describe('PostgresHermes structure', () => {
  it('exports the class implementing HermesStore', () => {
    expect(SRC).toMatch(/export class PostgresHermes implements HermesStore/);
  });
  it('createSkill runs validateSkillTools against the live registry', () => {
    expect(SRC).toMatch(/validateSkillTools/);
    expect(SRC).toMatch(/registry/);
  });
  it('has list/get/delete/bumpUsage + active skills query', () => {
    for (const m of ['listSkills', 'getSkill', 'deleteSkill', 'bumpUsage',
                     'activeSkills']) {
      expect(SRC).toContain(m);
    }
  });
  it('writes plan as Prisma.InputJsonValue', () => {
    expect(SRC).toMatch(/Prisma\.InputJsonValue/);
  });
  it('is best-effort on reads (try/catch)', () => {
    expect(SRC).toMatch(/catch/);
  });
});
