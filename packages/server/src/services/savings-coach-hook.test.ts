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
  it('переиспользует gatherReflectorFacts + computePortfolioPace + shouldNudgeOnExpense', () => {
    expect(SRC).toContain('gatherReflectorFacts');
    expect(SRC).toContain('computePortfolioPace');
    expect(SRC).toContain('shouldNudgeOnExpense');
  });
  it('дневной дедуп по scopeKey finance:goal_pace — scoped по source savings_coach', () => {
    expect(SRC).toContain("'finance:goal_pace'");
    expect(SRC).toContain('localDayStartUTC');
    // Реактив дедупится ТОЛЬКО против СВОИХ (source 'savings_coach'), НЕ
    // против дневного рефлектора — тот пишет тот же scopeKey и недоставленным
    // глушил реактив на весь день (живой баг 2026-06-02).
    expect(SRC).toMatch(/count\([\s\S]*?source: 'savings_coach'[\s\S]*?gte: dayStart/);
  });
});
