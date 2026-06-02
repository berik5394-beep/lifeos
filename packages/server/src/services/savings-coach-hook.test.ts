import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/savings-coach.ts'), 'utf-8');

describe('maybeSavingsCoachLine — проводка хука', () => {
  it('гейтнут флагом и не роняет расход (try/catch→null)', () => {
    expect(SRC).toContain('export async function maybeSavingsCoachLine');
    expect(SRC).toContain('isV2SavingsCoachEnabled');
    expect(SRC).toMatch(/catch[\s\S]{0,400}return null/);
  });
  it('переиспользует gatherReflectorFacts + computeSavingsPace + shouldNudgeOnExpense', () => {
    expect(SRC).toContain('gatherReflectorFacts');
    expect(SRC).toContain('computeSavingsPace');
    expect(SRC).toContain('shouldNudgeOnExpense');
  });
  it('дневной дедуп по scopeKey finance:goal_pace', () => {
    expect(SRC).toContain("'finance:goal_pace'");
    expect(SRC).toContain('localDayStartUTC');
  });
});
