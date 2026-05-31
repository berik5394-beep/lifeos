import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const TYPES = readFileSync(
  join(process.cwd(), 'src/services/user-axes/types.ts'), 'utf-8');
const MIG = readFileSync(
  join(process.cwd(), 'prisma/migrations/manual/2026-05-31-correction-log.sql'),
  'utf-8');

describe('B3 schema — AxisSignalSource', () => {
  it("adds 'feedback' to the source union", () => {
    expect(TYPES).toMatch(/'feedback'/);
  });
});

describe('B3 schema — CorrectionLog model', () => {
  it('declares the model with required fields', () => {
    expect(SCHEMA).toMatch(/model CorrectionLog \{/);
    for (const f of ['signalType', 'valence', 'dimension', 'appliedSignals',
                     'botExcerpt', 'userExcerpt', 'moodDelta', 'reaskSim']) {
      expect(SCHEMA).toContain(f);
    }
  });
  it('User has correctionLogs reverse relation', () => {
    expect(SCHEMA).toMatch(/correctionLogs\s+CorrectionLog\[\]/);
  });
});

describe('B3 schema — idempotent migration', () => {
  it('uses IF NOT EXISTS guards', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS "CorrectionLog"/);
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(MIG).toMatch(/DO \$\$/);
  });
});
