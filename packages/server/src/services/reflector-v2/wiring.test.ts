import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2ReflectorEnabled } from '../../lib/feature-flags.js';

const SCHED = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');

describe('isV2ReflectorEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_REFLECTOR; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_REFLECTOR;
    expect(isV2ReflectorEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_REFLECTOR = 'all';
    expect(isV2ReflectorEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_REFLECTOR = 'user-u1,user-u2';
    expect(isV2ReflectorEnabled('u1')).toBe(true);
    expect(isV2ReflectorEnabled('u3')).toBe(false);
  });
});

describe('scheduler wiring', () => {
  it('is gated and calls both runners', () => {
    expect(SCHED).toMatch(/isV2ReflectorEnabled/);
    expect(SCHED).toMatch(/runWeekly/);
    expect(SCHED).toMatch(/runEventCheck/);
  });
});
