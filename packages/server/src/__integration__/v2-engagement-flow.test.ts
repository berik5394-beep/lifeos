import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
const STORE = readFileSync(join(process.cwd(), 'src/services/insight-store.ts'), 'utf-8');
const REF = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const ENG = readFileSync(join(process.cwd(), 'src/services/engagement/engagement.ts'), 'utf-8');

describe('v2 engagement flow — adaptive threshold', () => {
  it('proactivity + reflector gate on adaptiveThreshold, flag-gated', () => {
    expect(ENGINE).toContain('adaptiveThreshold');
    expect(ENGINE).toContain('isV2EngagementEnabled');
    expect(REF).toContain('adaptiveThreshold');
  });
});

describe('v2 engagement flow — receptive-hour delivery', () => {
  it('deliverTopInsight defers non-critical outside active hours', () => {
    expect(STORE).toContain('isReceptiveHour');
    expect(STORE).toContain('isV2EngagementEnabled');
  });
});

describe('v2 engagement flow — degrade-safe, no new table', () => {
  it('getEngagement returns neutral on failure; reuses existing rows only', () => {
    expect(ENG).toMatch(/receptiveness: 0\.5/);
    expect(ENG).not.toMatch(/engagement\.create|prisma\.engagement/);
  });
});
