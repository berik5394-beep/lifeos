import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'runway.ts'), 'utf8');

describe('runway.ts — anchor integration (structural)', () => {
  it('gates snapshot anchor behind isV2RunwayBalanceEnabled', () => {
    expect(SRC).toMatch(/isV2RunwayBalanceEnabled\(/);
  });
  it('reads latest CashSnapshot ordered by asOf desc', () => {
    expect(SRC).toMatch(/cashSnapshot\.findFirst/);
    expect(SRC).toMatch(/asOf:\s*'desc'/);
  });
  it('sums expenses/incomes strictly after asOf (date gt)', () => {
    expect(SRC).toMatch(/date:\s*\{\s*gt:/);
  });
  it('uses computeAnchoredCash', () => {
    expect(SRC).toMatch(/computeAnchoredCash\(/);
  });
  it('READ-ONLY — no prisma writes', () => {
    expect(SRC).not.toMatch(
      /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/,
    );
    expect(SRC).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
  });
});
