import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const MIG = readFileSync(
  join(process.cwd(),
    'prisma/migrations/20260531210000_v2_hermes_skills/migration.sql'),
  'utf-8');

describe('B4 schema — SkillDefinition model', () => {
  it('declares the model with required fields', () => {
    expect(SCHEMA).toMatch(/model SkillDefinition \{/);
    for (const f of ['triggers', 'plan', 'synthesis', 'source',
                     'active', 'useCount', 'lastUsedAt']) {
      expect(SCHEMA).toContain(f);
    }
  });
  it('User has skills reverse relation', () => {
    expect(SCHEMA).toMatch(/skills\s+SkillDefinition\[\]/);
  });
});

describe('B4 schema — idempotent standard migration', () => {
  it('uses IF NOT EXISTS + pg_constraint guard', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS "SkillDefinition"/);
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(MIG).toMatch(/pg_constraint/);
  });
});
