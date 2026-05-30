import { describe, it, expect, afterEach } from 'vitest';
import {
  isV2MemoryEnabled,
  isV2ProactivityEnabled,
  isV2CronEnabled,
} from './feature-flags.js';

const ORIG_MEM = process.env.FEATURE_V2_MEMORY;
const ORIG_PROAC = process.env.FEATURE_V2_PROACTIVITY;

afterEach(() => {
  if (ORIG_MEM === undefined) delete process.env.FEATURE_V2_MEMORY;
  else process.env.FEATURE_V2_MEMORY = ORIG_MEM;
  if (ORIG_PROAC === undefined) delete process.env.FEATURE_V2_PROACTIVITY;
  else process.env.FEATURE_V2_PROACTIVITY = ORIG_PROAC;
});

describe('isV2MemoryEnabled', () => {
  it('returns false when env unset', () => {
    delete process.env.FEATURE_V2_MEMORY;
    expect(isV2MemoryEnabled('user1')).toBe(false);
  });

  it.each(['', 'none', 'false'])('returns false when env = %s', (v) => {
    process.env.FEATURE_V2_MEMORY = v;
    expect(isV2MemoryEnabled('user1')).toBe(false);
  });

  it('returns true for all users when env = "all"', () => {
    process.env.FEATURE_V2_MEMORY = 'all';
    expect(isV2MemoryEnabled('user1')).toBe(true);
    expect(isV2MemoryEnabled('user-zzz')).toBe(true);
  });

  it('returns true only for listed userIds (comma-separated)', () => {
    process.env.FEATURE_V2_MEMORY = 'user-berikId,user-aydanaId';
    expect(isV2MemoryEnabled('berikId')).toBe(true);
    expect(isV2MemoryEnabled('aydanaId')).toBe(true);
    expect(isV2MemoryEnabled('otherId')).toBe(false);
  });

  it('handles whitespace around entries', () => {
    process.env.FEATURE_V2_MEMORY = ' user-a , user-b ';
    expect(isV2MemoryEnabled('a')).toBe(true);
    expect(isV2MemoryEnabled('b')).toBe(true);
  });

  it('ignores trailing/leading whitespace in flag itself', () => {
    process.env.FEATURE_V2_MEMORY = '  all  ';
    expect(isV2MemoryEnabled('x')).toBe(true);
  });
});

describe('isV2ProactivityEnabled', () => {
  it('uses separate FEATURE_V2_PROACTIVITY env', () => {
    delete process.env.FEATURE_V2_PROACTIVITY;
    process.env.FEATURE_V2_MEMORY = 'all';  // memory ON but proactivity not
    expect(isV2ProactivityEnabled('user1')).toBe(false);
  });

  it('returns true when env = "all"', () => {
    process.env.FEATURE_V2_PROACTIVITY = 'all';
    expect(isV2ProactivityEnabled('user1')).toBe(true);
  });
});

describe('isV2CronEnabled — global flag (no userId arg)', () => {
  const ORIG = process.env.FEATURE_V2_CRON;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_CRON;
    else process.env.FEATURE_V2_CRON = ORIG;
  });
  it('unset → false', () => {
    delete process.env.FEATURE_V2_CRON;
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"none" → false', () => {
    process.env.FEATURE_V2_CRON = 'none';
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"false" → false', () => {
    process.env.FEATURE_V2_CRON = 'false';
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.FEATURE_V2_CRON = 'true';
    expect(isV2CronEnabled()).toBe(true);
  });
  it('"all" → true (alias for true)', () => {
    process.env.FEATURE_V2_CRON = 'all';
    expect(isV2CronEnabled()).toBe(true);
  });
  it('"  true  " → true (whitespace tolerant)', () => {
    process.env.FEATURE_V2_CRON = '  true  ';
    expect(isV2CronEnabled()).toBe(true);
  });
});
