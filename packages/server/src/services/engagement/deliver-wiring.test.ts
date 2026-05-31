import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/insight-store.ts'), 'utf-8');

describe('deliverTopInsight receptive-hour defer', () => {
  it('imports engagement + flag', () => {
    expect(SRC).toMatch(/isV2EngagementEnabled/);
    expect(SRC).toMatch(/getEngagement/);
    expect(SRC).toMatch(/isReceptiveHour/);
  });
  it('defers non-critical outside the receptive hour (critical bypass)', () => {
    expect(SRC).toMatch(/severityBand|>= 8/);
    expect(SRC).toMatch(/isReceptiveHour\(/);
  });
});
