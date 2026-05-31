import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const ENRICH = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
const SCHED = readFileSync(join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');
const ENGINE = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('v2 identity flow — inbound tone', () => {
  it('orchestrator refreshes traits then enrichment renders tone', () => {
    expect(ORCH).toMatch(/refreshTraitsIfStale\(/);
    expect(ENRICH).toContain('formatToneSection');
  });
  it('both gated by isV2IdentityEnabled', () => {
    expect(ORCH).toContain('isV2IdentityEnabled');
    expect(ENRICH).toContain('isV2IdentityEnabled');
  });
});

describe('v2 identity flow — weekly snapshot', () => {
  it('scheduler runs bot-traits-snapshot cron', () => {
    expect(SCHED).toMatch(/bot-traits-snapshot/);
    expect(SCHED).toContain('snapshot');
  });
});

describe('v2 identity flow — proactive growth comment', () => {
  it('engine has identity_growth detector wired', () => {
    expect(ENGINE).toContain('detectIdentityGrowth');
    expect(ENGINE).toContain('identity_growth');
  });
});
