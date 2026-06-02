import { describe, it, expect, afterEach } from 'vitest';
import { isV2SavingsCoachEnabled } from './feature-flags.js';

const KEY = 'FEATURE_V2_SAVINGS_COACH';
afterEach(() => {
  delete process.env[KEY];
});

describe('isV2SavingsCoachEnabled', () => {
  it('unset → false', () => {
    expect(isV2SavingsCoachEnabled('u1')).toBe(false);
  });
  it('"all" → true', () => {
    process.env[KEY] = 'all';
    expect(isV2SavingsCoachEnabled('u1')).toBe(true);
  });
  it('"none" → false', () => {
    process.env[KEY] = 'none';
    expect(isV2SavingsCoachEnabled('u1')).toBe(false);
  });
  it('per-user список', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2SavingsCoachEnabled('u1')).toBe(true);
    expect(isV2SavingsCoachEnabled('u3')).toBe(false);
  });
});
