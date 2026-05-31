import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const IDX = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const GATHER = readFileSync(join(process.cwd(), 'src/services/reflector-v2/gather-facts.ts'), 'utf-8');
const SCHED = readFileSync(join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');

describe('v2 reflector flow — reuses existing insight store', () => {
  it('writes keystones via persistCandidates with source reflector_v2', () => {
    expect(IDX).toMatch(/persistCandidates/);
    expect(IDX).toMatch(/'reflector_v2'/);
  });
  it('no new prisma model — reuses Insight (no reflector table create)', () => {
    expect(IDX).not.toMatch(/reflectorV2\.create|prisma\.reflector/);
  });
});

describe('v2 reflector flow — cross-tier consumption', () => {
  it('gatherFacts reads >=3 distinct v2 tiers', () => {
    const tiers = ['getAxes', 'getTraits', 'getMoodTimeline', 'recentCorrections', 'listSkills', 'staleEntities', 'getActivePatterns'];
    const hit = tiers.filter((t) => GATHER.includes(t)).length;
    expect(hit).toBeGreaterThanOrEqual(3);
  });
});

describe('v2 reflector flow — wiring', () => {
  it('scheduler runs both reflector-v2 entrypoints, gated', () => {
    expect(SCHED).toContain('isV2ReflectorEnabled');
    expect(SCHED).toContain('runWeekly');
    expect(SCHED).toContain('runEventCheck');
  });
});
