import { describe, it, expect, afterEach } from 'vitest';
import {
  isV2RealtimeEnabled,
  isV2DayLoadEnabled,
  isV2AntiFabEnabled,
  isV2WeekLoadEnabled,
  isV2MonthLoadEnabled,
  isV2YearLoadEnabled,
  isV2EntityResolveEnabled,
  isV2PatternDedupEnabled,
  isV2SupersedeEnabled,
  isV2UnlinkEnabled,
} from './feature-flags.js';


describe('isV2EntityResolveEnabled', () => {
  const KEY = 'FEATURE_V2_ENTITY_RESOLVE';
  const orig = process.env[KEY];
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
  it('unset → false', () => { delete process.env[KEY]; expect(isV2EntityResolveEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2EntityResolveEnabled('u1')).toBe(true); });
  it('none/false/empty → false', () => {
    for (const v of ['none', 'false', '']) { process.env[KEY] = v; expect(isV2EntityResolveEnabled('u1')).toBe(false); }
  });
  it('csv matches only listed user', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2EntityResolveEnabled('u1')).toBe(true);
    expect(isV2EntityResolveEnabled('u3')).toBe(false);
  });
});

describe('isV2PatternDedupEnabled', () => {
  const KEY = 'FEATURE_V2_PATTERN_DEDUP'; const orig = process.env[KEY];
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
  it('unset → false', () => { delete process.env[KEY]; expect(isV2PatternDedupEnabled('u1')).toBe(false); });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2PatternDedupEnabled('u1')).toBe(true); });
  it('none/false/empty → false', () => { for (const v of ['none','false','']) { process.env[KEY]=v; expect(isV2PatternDedupEnabled('u1')).toBe(false); } });
  it('csv', () => { process.env[KEY]='user-u1'; expect(isV2PatternDedupEnabled('u1')).toBe(true); expect(isV2PatternDedupEnabled('u2')).toBe(false); });
});

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

describe('isV2AntiFabEnabled (Слой честности B)', () => {
  const KEY = 'FEATURE_V2_ANTIFAB'; const ORIG = process.env[KEY];
  afterEach(() => { if (ORIG === undefined) delete process.env[KEY]; else process.env[KEY] = ORIG; });
  it('off по умолчанию', () => { delete process.env[KEY]; expect(isV2AntiFabEnabled('u1')).toBe(false); });
  it('all → включено', () => { process.env[KEY] = 'all'; expect(isV2AntiFabEnabled('u1')).toBe(true); });
  it('none/false → off', () => { for (const v of ['none','false','']) { process.env[KEY]=v; expect(isV2AntiFabEnabled('u1')).toBe(false); } });
  it('csv адресно', () => { process.env[KEY]='user-u1'; expect(isV2AntiFabEnabled('u1')).toBe(true); expect(isV2AntiFabEnabled('u2')).toBe(false); });
});

describe('isV2RealtimeEnabled', () => {
  const ORIG = process.env.FEATURE_V2_REALTIME;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_REALTIME;
    else process.env.FEATURE_V2_REALTIME = ORIG;
  });
  it('unset → false', () => {
    delete process.env.FEATURE_V2_REALTIME;
    expect(isV2RealtimeEnabled('user1')).toBe(false);
  });
  it('all → true для всех', () => {
    process.env.FEATURE_V2_REALTIME = 'all';
    expect(isV2RealtimeEnabled('user1')).toBe(true);
    expect(isV2RealtimeEnabled('user-zzz')).toBe(true);
  });
  it('user-list → только перечисленные', () => {
    process.env.FEATURE_V2_REALTIME = 'user-berikId,user-aydanaId';
    expect(isV2RealtimeEnabled('berikId')).toBe(true);
    expect(isV2RealtimeEnabled('otherId')).toBe(false);
  });
});

describe('isV2SupersedeEnabled', () => {
  const KEY = 'FEATURE_V2_SUPERSEDE'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY] = 'all'; expect(isV2SupersedeEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2SupersedeEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2SupersedeEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2SupersedeEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2SupersedeEnabled('abc')).toBe(true); expect(isV2SupersedeEnabled('z')).toBe(false); });
});

describe('isV2UnlinkEnabled', () => {
  const KEY = 'FEATURE_V2_UNLINK'; const prev = process.env[KEY];
  afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });
  it('all→true', () => { process.env[KEY]='all'; expect(isV2UnlinkEnabled('u')).toBe(true); });
  it('unset/none/empty→false', () => { delete process.env[KEY]; expect(isV2UnlinkEnabled('u')).toBe(false); process.env[KEY]='none'; expect(isV2UnlinkEnabled('u')).toBe(false); process.env[KEY]=''; expect(isV2UnlinkEnabled('u')).toBe(false); });
  it('csv', () => { process.env[KEY]='user-abc'; expect(isV2UnlinkEnabled('abc')).toBe(true); expect(isV2UnlinkEnabled('z')).toBe(false); });
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
