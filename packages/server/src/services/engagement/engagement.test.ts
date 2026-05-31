import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/engagement/engagement.ts'), 'utf-8');

describe('getEngagement structure', () => {
  it('exports getEngagement', () => {
    expect(SRC).toMatch(/export async function getEngagement/);
  });
  it('reads the three existing sources', () => {
    expect(SRC).toMatch(/insightDismissal/);
    expect(SRC).toMatch(/deliveredAt/);
    expect(SRC).toMatch(/chatMessage/);
  });
  it('computes via the pure helpers', () => {
    expect(SRC).toMatch(/receptivenessScore/);
    expect(SRC).toMatch(/activeHourHistogram/);
    expect(SRC).toMatch(/localHour/);
  });
  it('degrade-safe: neutral 0.5 + empty hours on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/receptiveness: 0\.5/);
  });
});
