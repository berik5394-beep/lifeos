import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2HermesEnabled } from '../../lib/feature-flags.js';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('isV2HermesEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_HERMES; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_HERMES;
    expect(isV2HermesEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_HERMES = 'all';
    expect(isV2HermesEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_HERMES = 'user-u1,user-u2';
    expect(isV2HermesEnabled('u1')).toBe(true);
    expect(isV2HermesEnabled('u3')).toBe(false);
  });
});

describe('orchestrator hermes run-seed', () => {
  it('is gated by isV2HermesEnabled', () => {
    expect(ORCH).toMatch(/isV2HermesEnabled/);
  });
  it('routes to a skill and seeds the system prompt', () => {
    expect(ORCH).toMatch(/routeToSkill/);
    expect(ORCH).toMatch(/buildSkillInstruction/);
    expect(ORCH).toMatch(/bumpUsage/);
  });
});
