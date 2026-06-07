import { describe, it, expect, afterEach } from 'vitest';
import {
  isV2MemoryEnabled,
  isV2ProactivityEnabled,
  isV2AxesEnabled,
  isV2ObligationsEnabled,
  isV2GoalImpactEnabled,
  isV2RunwayEnabled,
  isV2RunwayBalanceEnabled,
  isV2DecisionsEnabled,
  isV2EnergyEnabled,
  isV2RelationshipsEnabled,
  isV2CronEnabled,
  isV2IdentityEnabled,
  isV2WriteEnabled,
  isV2RealtimeEnabled,
  isV2DayLoadEnabled,
  isV2WeekLoadEnabled,
  isV2MonthLoadEnabled,
  isV2YearLoadEnabled,
  isV2BirthdayEnabled,
  isV2GoalHabitsEnabled,
  isV2PersonTypesEnabled,
} from './feature-flags.js';

const ORIG_MEM = process.env.FEATURE_V2_MEMORY;
const ORIG_PROAC = process.env.FEATURE_V2_PROACTIVITY;

afterEach(() => {
  if (ORIG_MEM === undefined) delete process.env.FEATURE_V2_MEMORY;
  else process.env.FEATURE_V2_MEMORY = ORIG_MEM;
  if (ORIG_PROAC === undefined) delete process.env.FEATURE_V2_PROACTIVITY;
  else process.env.FEATURE_V2_PROACTIVITY = ORIG_PROAC;
});

describe('isV2BirthdayEnabled', () => {
  const KEY = 'FEATURE_V2_BIRTHDAY';
  afterEach(() => { delete process.env[KEY]; });

  it('undefined env → false', () => {
    delete process.env[KEY];
    expect(isV2BirthdayEnabled('u1')).toBe(false);
  });
  it('"all" → true для любого', () => {
    process.env[KEY] = 'all';
    expect(isV2BirthdayEnabled('u1')).toBe(true);
  });
  it('"none"/"" → false', () => {
    process.env[KEY] = 'none';
    expect(isV2BirthdayEnabled('u1')).toBe(false);
    process.env[KEY] = '';
    expect(isV2BirthdayEnabled('u1')).toBe(false);
  });
  it('user-<id> → только адресно', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2BirthdayEnabled('u1')).toBe(true);
    expect(isV2BirthdayEnabled('u3')).toBe(false);
  });
});

describe('isV2GoalHabitsEnabled', () => {
  const KEY = 'FEATURE_V2_GOAL_HABITS';
  afterEach(() => { delete process.env[KEY]; });
  it('undefined → false', () => { delete process.env[KEY]; expect(isV2GoalHabitsEnabled('u1')).toBe(false); });
  it('"all" → true', () => { process.env[KEY] = 'all'; expect(isV2GoalHabitsEnabled('u1')).toBe(true); });
  it('user-<id> адресно', () => {
    process.env[KEY] = 'user-u1';
    expect(isV2GoalHabitsEnabled('u1')).toBe(true);
    expect(isV2GoalHabitsEnabled('u2')).toBe(false);
  });
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

describe('isV2AxesEnabled', () => {
  const origEnv = process.env.FEATURE_V2_AXES;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.FEATURE_V2_AXES;
    else process.env.FEATURE_V2_AXES = origEnv;
  });

  it('returns false when env var unset', () => {
    delete process.env.FEATURE_V2_AXES;
    expect(isV2AxesEnabled('user-abc')).toBe(false);
  });
  it('returns false when env var = "none" or "false"', () => {
    process.env.FEATURE_V2_AXES = 'none';
    expect(isV2AxesEnabled('user-abc')).toBe(false);
    process.env.FEATURE_V2_AXES = 'false';
    expect(isV2AxesEnabled('user-abc')).toBe(false);
  });
  it('returns true for "all" or "true"', () => {
    process.env.FEATURE_V2_AXES = 'all';
    expect(isV2AxesEnabled('user-anybody')).toBe(true);
    process.env.FEATURE_V2_AXES = 'true';
    expect(isV2AxesEnabled('user-anybody')).toBe(true);
  });
  it('returns true for matching user-{id} in comma list', () => {
    process.env.FEATURE_V2_AXES = 'user-abc,user-def';
    expect(isV2AxesEnabled('abc')).toBe(true);
    expect(isV2AxesEnabled('def')).toBe(true);
    expect(isV2AxesEnabled('xyz')).toBe(false);
  });
  it('tolerates whitespace around commas', () => {
    process.env.FEATURE_V2_AXES = '  user-abc , user-def  ';
    expect(isV2AxesEnabled('abc')).toBe(true);
    expect(isV2AxesEnabled('def')).toBe(true);
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

describe('isV2IdentityEnabled', () => {
  const orig = process.env.FEATURE_V2_IDENTITY;
  afterEach(() => {
    if (orig === undefined) delete process.env.FEATURE_V2_IDENTITY;
    else process.env.FEATURE_V2_IDENTITY = orig;
  });
  it('unset → false', () => {
    delete process.env.FEATURE_V2_IDENTITY;
    expect(isV2IdentityEnabled('user-abc')).toBe(false);
  });
  it('none/false → false', () => {
    process.env.FEATURE_V2_IDENTITY = 'none';
    expect(isV2IdentityEnabled('abc')).toBe(false);
    process.env.FEATURE_V2_IDENTITY = 'false';
    expect(isV2IdentityEnabled('abc')).toBe(false);
  });
  it('all/true → true', () => {
    process.env.FEATURE_V2_IDENTITY = 'all';
    expect(isV2IdentityEnabled('anybody')).toBe(true);
    process.env.FEATURE_V2_IDENTITY = 'true';
    expect(isV2IdentityEnabled('anybody')).toBe(true);
  });
  it('per-user comma list', () => {
    process.env.FEATURE_V2_IDENTITY = 'user-abc,user-def';
    expect(isV2IdentityEnabled('abc')).toBe(true);
    expect(isV2IdentityEnabled('xyz')).toBe(false);
  });
  it('tolerates whitespace', () => {
    process.env.FEATURE_V2_IDENTITY = '  user-abc , user-def ';
    expect(isV2IdentityEnabled('abc')).toBe(true);
  });
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

describe('isV2WriteEnabled', () => {
  const ORIG = process.env.FEATURE_V2_WRITE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_WRITE;
    else process.env.FEATURE_V2_WRITE = ORIG;
  });

  it('returns false when env unset', () => {
    delete process.env.FEATURE_V2_WRITE;
    expect(isV2WriteEnabled('user1')).toBe(false);
  });

  it.each(['', 'none', 'false'])('returns false when env = %s', (v) => {
    process.env.FEATURE_V2_WRITE = v;
    expect(isV2WriteEnabled('user1')).toBe(false);
  });

  it('returns true for all users when env = "all"', () => {
    process.env.FEATURE_V2_WRITE = 'all';
    expect(isV2WriteEnabled('user1')).toBe(true);
    expect(isV2WriteEnabled('user-zzz')).toBe(true);
  });

  it('returns true only for listed userIds (comma-separated)', () => {
    process.env.FEATURE_V2_WRITE = 'user-berikId,user-aydanaId';
    expect(isV2WriteEnabled('berikId')).toBe(true);
    expect(isV2WriteEnabled('aydanaId')).toBe(true);
    expect(isV2WriteEnabled('otherId')).toBe(false);
  });

  it('handles whitespace around entries', () => {
    process.env.FEATURE_V2_WRITE = ' user-a , user-b ';
    expect(isV2WriteEnabled('a')).toBe(true);
    expect(isV2WriteEnabled('b')).toBe(true);
  });

  it('ignores trailing/leading whitespace in flag itself', () => {
    process.env.FEATURE_V2_WRITE = '  all  ';
    expect(isV2WriteEnabled('x')).toBe(true);
  });
});

describe('isV2ObligationsEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_OBLIGATIONS;
  });
  it('unset → false', () => {
    expect(isV2ObligationsEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_OBLIGATIONS = 'all';
    expect(isV2ObligationsEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_OBLIGATIONS = 'user-u1,user-u2';
    expect(isV2ObligationsEnabled('u1')).toBe(true);
    expect(isV2ObligationsEnabled('u3')).toBe(false);
  });
});

describe('isV2GoalImpactEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_GOAL_IMPACT;
  });
  it('unset → false', () => {
    expect(isV2GoalImpactEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_GOAL_IMPACT = 'all';
    expect(isV2GoalImpactEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_GOAL_IMPACT = 'user-u1';
    expect(isV2GoalImpactEnabled('u1')).toBe(true);
    expect(isV2GoalImpactEnabled('u2')).toBe(false);
  });
});

describe('isV2RunwayEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_RUNWAY;
  });
  it('unset → false', () => {
    expect(isV2RunwayEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_RUNWAY = 'all';
    expect(isV2RunwayEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_RUNWAY = 'user-u1';
    expect(isV2RunwayEnabled('u1')).toBe(true);
    expect(isV2RunwayEnabled('u2')).toBe(false);
  });
});

describe('isV2RunwayBalanceEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_RUNWAY_BALANCE;
  });
  it('unset → false', () => {
    expect(isV2RunwayBalanceEnabled('u1')).toBe(false);
  });
  it('none/false/empty → false', () => {
    for (const v of ['none', 'false', '']) {
      process.env.FEATURE_V2_RUNWAY_BALANCE = v;
      expect(isV2RunwayBalanceEnabled('u1')).toBe(false);
    }
  });
  it('all/true → true', () => {
    process.env.FEATURE_V2_RUNWAY_BALANCE = 'all';
    expect(isV2RunwayBalanceEnabled('anybody')).toBe(true);
    process.env.FEATURE_V2_RUNWAY_BALANCE = 'true';
    expect(isV2RunwayBalanceEnabled('anybody')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_RUNWAY_BALANCE = 'user-u1';
    expect(isV2RunwayBalanceEnabled('u1')).toBe(true);
    expect(isV2RunwayBalanceEnabled('u2')).toBe(false);
  });
});

describe('isV2DecisionsEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_DECISIONS;
  });
  it('unset → false', () => {
    expect(isV2DecisionsEnabled('u1')).toBe(false);
  });
  it('none/false/empty → false', () => {
    for (const v of ['none', 'false', '']) {
      process.env.FEATURE_V2_DECISIONS = v;
      expect(isV2DecisionsEnabled('u1')).toBe(false);
    }
  });
  it('all/true → true', () => {
    process.env.FEATURE_V2_DECISIONS = 'all';
    expect(isV2DecisionsEnabled('anybody')).toBe(true);
    process.env.FEATURE_V2_DECISIONS = 'true';
    expect(isV2DecisionsEnabled('anybody')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_DECISIONS = 'user-u1';
    expect(isV2DecisionsEnabled('u1')).toBe(true);
    expect(isV2DecisionsEnabled('u2')).toBe(false);
  });
});

describe('isV2EnergyEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_ENERGY;
  });
  it('unset → false', () => {
    expect(isV2EnergyEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_ENERGY = 'all';
    expect(isV2EnergyEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_ENERGY = 'user-u1';
    expect(isV2EnergyEnabled('u1')).toBe(true);
    expect(isV2EnergyEnabled('u2')).toBe(false);
  });
});

describe('isV2RelationshipsEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_RELATIONSHIPS;
  });
  it('unset → false', () => {
    expect(isV2RelationshipsEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_RELATIONSHIPS = 'all';
    expect(isV2RelationshipsEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_RELATIONSHIPS = 'user-u1';
    expect(isV2RelationshipsEnabled('u1')).toBe(true);
    expect(isV2RelationshipsEnabled('u2')).toBe(false);
  });
});

describe('isV2PersonTypesEnabled', () => {
  afterEach(() => {
    delete process.env.FEATURE_V2_PERSON_TYPES;
  });
  it('unset → false', () => {
    expect(isV2PersonTypesEnabled('u1')).toBe(false);
  });
  it('all → true', () => {
    process.env.FEATURE_V2_PERSON_TYPES = 'all';
    expect(isV2PersonTypesEnabled('u1')).toBe(true);
  });
  it('user-list матчит только своих', () => {
    process.env.FEATURE_V2_PERSON_TYPES = 'user-u1';
    expect(isV2PersonTypesEnabled('u1')).toBe(true);
    expect(isV2PersonTypesEnabled('u2')).toBe(false);
  });
});
