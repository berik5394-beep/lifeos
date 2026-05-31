import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2EngagementEnabled } from '../../lib/feature-flags.js';

const ENG = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
const REF = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');

describe('isV2EngagementEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_ENGAGEMENT; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_ENGAGEMENT;
    expect(isV2EngagementEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_ENGAGEMENT = 'all';
    expect(isV2EngagementEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_ENGAGEMENT = 'user-u1';
    expect(isV2EngagementEnabled('u1')).toBe(true);
    expect(isV2EngagementEnabled('u2')).toBe(false);
  });
});

describe('adaptive threshold wiring', () => {
  it('proactivity gate3 uses adaptiveThreshold gated by the flag', () => {
    expect(ENG).toMatch(/isV2EngagementEnabled/);
    expect(ENG).toMatch(/adaptiveThreshold/);
    expect(ENG).toMatch(/gate3_Significance\(c, /);
  });
  it('reflector event check uses an adaptive threshold', () => {
    expect(REF).toMatch(/isV2EngagementEnabled/);
    expect(REF).toMatch(/adaptiveThreshold/);
    expect(REF).toMatch(/significanceScore/);
  });
});
