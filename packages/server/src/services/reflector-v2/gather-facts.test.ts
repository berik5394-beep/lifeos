import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/gather-facts.ts'), 'utf-8');

describe('gather-facts structure', () => {
  it('exports gatherFacts', () => {
    expect(SRC).toMatch(/export async function gatherFacts/);
  });
  it('reads the v2 tiers via their stores', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.getAxes/);
    expect(SRC).toMatch(/getBotTraitsStore\(\)\.getTraits/);
    expect(SRC).toMatch(/recentCorrections/);
    expect(SRC).toMatch(/getMoodTimeline|detectMoodShift/);
    expect(SRC).toMatch(/listSkills/);
    expect(SRC).toMatch(/staleEntities/);
    expect(SRC).toMatch(/getActivePatterns/);
  });
  it('computes a legacy summary (finance/habits/tasks)', () => {
    expect(SRC).toMatch(/legacy/);
    expect(SRC).toMatch(/monthlyBurn/);
  });
  it('is best-effort — each tier wrapped, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });
});
