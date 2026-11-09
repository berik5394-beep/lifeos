import { describe, it, expect, afterEach } from 'vitest';
import {
  isV2DayLoadEnabled,
  isV2WeekLoadEnabled,
  isV2MonthLoadEnabled,
  isV2YearLoadEnabled,
} from './feature-flags.js';


describe('isV2YearLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_YEAR_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_YEAR_LOAD;
    else process.env.FEATURE_V2_YEAR_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_YEAR_LOAD;
    expect(isV2YearLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_YEAR_LOAD = 'all';
    expect(isV2YearLoadEnabled('u1')).toBe(true);
  });
});

describe('isV2MonthLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_MONTH_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_MONTH_LOAD;
    else process.env.FEATURE_V2_MONTH_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_MONTH_LOAD;
    expect(isV2MonthLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_MONTH_LOAD = 'all';
    expect(isV2MonthLoadEnabled('u1')).toBe(true);
  });
});

describe('isV2WeekLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_WEEK_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_WEEK_LOAD;
    else process.env.FEATURE_V2_WEEK_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_WEEK_LOAD;
    expect(isV2WeekLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_WEEK_LOAD = 'all';
    expect(isV2WeekLoadEnabled('u1')).toBe(true);
  });
});

describe('isV2DayLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_DAY_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_DAY_LOAD;
    else process.env.FEATURE_V2_DAY_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_DAY_LOAD;
    expect(isV2DayLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_DAY_LOAD = 'all';
    expect(isV2DayLoadEnabled('u1')).toBe(true);
  });
});

import { isV2GoalIntakeEnabled } from './feature-flags.js';
describe('isV2GoalIntakeEnabled', () => {
  const KEY = 'FEATURE_V2_GOAL_INTAKE'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2GoalIntakeEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2GoalIntakeEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2GoalIntakeEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2GoalIntakeEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2GoalIntakeEnabled('abc')).toBe(true); expect(isV2GoalIntakeEnabled('z')).toBe(false); });
});

import { isV2TaskGoalLinkEnabled } from './feature-flags.js';
describe('isV2TaskGoalLinkEnabled', () => {
  const KEY = 'FEATURE_V2_TASK_GOAL_LINK'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2TaskGoalLinkEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2TaskGoalLinkEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2TaskGoalLinkEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2TaskGoalLinkEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2TaskGoalLinkEnabled('abc')).toBe(true); expect(isV2TaskGoalLinkEnabled('z')).toBe(false); });
});

describe('featureFlagSnapshot — лог флагов без id', () => {
  it('значения как есть, списки — числом, без самих id', async () => {
    const { featureFlagSnapshot } = await import('./feature-flags.js');
    const s = featureFlagSnapshot({ FEATURE_V2_B: 'all', FEATURE_V2_A: 'user-1,user-2', FEATURE_V2_C: '', OTHER: 'x' } as NodeJS.ProcessEnv);
    expect(s).toBe('V2_A=список(2) V2_B=all V2_C=(пусто)');
    expect(s).not.toContain('user-1');
  });
});
