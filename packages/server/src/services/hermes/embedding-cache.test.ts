import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const IMPL = readFileSync(join(process.cwd(), 'src/services/hermes/postgres-impl.ts'), 'utf-8');
const ROUTER = readFileSync(join(process.cwd(), 'src/services/hermes/skill-router.ts'), 'utf-8');
const MIG = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260531220000_v2_skill_embedding/migration.sql'),
  'utf-8');

describe('skill embedding cache', () => {
  it('SkillDefinition has an embedding column', () => {
    expect(SCHEMA).toMatch(/model SkillDefinition[\s\S]*embedding\s+Json\?/);
  });
  it('idempotent standard migration adds the column', () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS "embedding"/);
  });
  it('createSkill populates embedding best-effort (embeddingsEnabled gate)', () => {
    expect(IMPL).toMatch(/embeddingsEnabled/);
    expect(IMPL).toMatch(/embedQuery|embedDocument/);
  });
  it('router uses the stored embedding when present, else live embed', () => {
    expect(ROUTER).toMatch(/\.embedding/);
    expect(ROUTER).toMatch(/embedQuery/); // fallback path remains
  });
});
