import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'proactive-scheduler.ts'), 'utf8');

describe('proactive-scheduler — v2 cron wiring (A5)', () => {
  it('imports isV2CronEnabled', () => {
    expect(SRC).toMatch(/isV2CronEnabled/);
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
  });
  it('imports both cron tasks', () => {
    expect(SRC).toMatch(/from '\.\/cron\/mood-retention-cron\.js'/);
    expect(SRC).toMatch(/from '\.\/cron\/pattern-extraction-cron\.js'/);
    expect(SRC).toMatch(/runMoodRetention/);
    expect(SRC).toMatch(/runPatternExtraction/);
  });
  it('imports withCronLock from cron-runner', () => {
    expect(SRC).toMatch(/from '\.\/cron-runner\.js'/);
    expect(SRC).toMatch(/withCronLock/);
  });
  it('hooks run BEFORE the per-user loop', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    const moodIdx = tickFn.indexOf('runMoodRetention');
    const patternIdx = tickFn.indexOf('runPatternExtraction');
    const loopIdx = tickFn.indexOf('for (const { id: userId }');
    expect(moodIdx).toBeGreaterThan(0);
    expect(patternIdx).toBeGreaterThan(0);
    expect(loopIdx).toBeGreaterThan(0);
    expect(moodIdx).toBeLessThan(loopIdx);
    expect(patternIdx).toBeLessThan(loopIdx);
  });
  it('both hooks are gated by isV2CronEnabled()', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    // Two flag checks before the loop
    const beforeLoop = tickFn.slice(0, tickFn.indexOf('for (const { id: userId }'));
    const flagChecks = beforeLoop.match(/isV2CronEnabled\(\s*\)/g) ?? [];
    expect(flagChecks.length).toBeGreaterThanOrEqual(1);
  });
  it('mood-retention uses 24h interval, pattern-extraction uses 7d', () => {
    expect(SRC).toMatch(/withCronLock\(\s*['"]mood-retention['"]\s*,\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(SRC).toMatch(/withCronLock\(\s*['"]pattern-extraction['"]\s*,\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
  it('each hook in its own try/catch with cron prefix log', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,150}?\[cron:/);
  });
});
