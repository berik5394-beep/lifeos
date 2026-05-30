import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C2 — Integration test for the outbound proactivity flow.
 *
 * Chain (per spec §8.2):
 *   scheduler.tick()
 *     → [cron] mood-retention + pattern-extraction (Week 6 A5)
 *     → for each user:
 *         → engine.runForUser
 *           → detectCandidates (5 detectors)
 *           → filterCandidates (4 gates)
 *           → generateNudge
 *           → persistCandidates → Insight row
 *     → deliverTopInsight (picks up the new Insight, pushes via R6)
 *
 * Structural test only — verifies wiring + ordering. E2E coverage via
 * Week 7 SMOKE (Berik on Railway with 3-day observation window).
 */

const ROOT = join(__dirname, '..', 'services');
const SCHED = readFileSync(join(ROOT, 'proactive-scheduler.ts'), 'utf8');
const ENGINE = readFileSync(join(ROOT, 'v2-proactivity-engine.ts'), 'utf8');

describe('v2 proactivity flow — scheduler → engine chain', () => {
  it('scheduler imports the engine singleton + cron primitives', () => {
    expect(SCHED).toMatch(/getProactivityEngine/);
    expect(SCHED).toMatch(/withCronLock/);
    expect(SCHED).toMatch(/runMoodRetention/);
    expect(SCHED).toMatch(/runPatternExtraction/);
  });

  it('cron hooks land BEFORE the per-user loop (so engine reads fresh data)', () => {
    const tickFn = SCHED.slice(SCHED.indexOf('async function tick'));
    const moodIdx = tickFn.indexOf('runMoodRetention');
    const patternIdx = tickFn.indexOf('runPatternExtraction');
    const loopIdx = tickFn.indexOf('for (const { id: userId }');
    expect(moodIdx).toBeGreaterThan(0);
    expect(patternIdx).toBeGreaterThan(0);
    expect(loopIdx).toBeGreaterThan(Math.max(moodIdx, patternIdx));
  });

  it('engine call sits BEFORE deliverTopInsight (so same tick pushes nudge)', () => {
    const tickFn = SCHED.slice(SCHED.indexOf('async function tick'));
    const runIdx = tickFn.indexOf('runForUser');
    const delivIdx = tickFn.indexOf('deliverTopInsight');
    expect(runIdx).toBeGreaterThan(0);
    expect(delivIdx).toBeGreaterThan(0);
    expect(runIdx).toBeLessThan(delivIdx);
  });

  it('engine.runForUser is gated by isV2ProactivityEnabled', () => {
    expect(SCHED).toMatch(/isV2ProactivityEnabled\(\s*userId\s*\)/);
  });

  it('cron hooks are gated by isV2CronEnabled (global)', () => {
    expect(SCHED).toMatch(/isV2CronEnabled\(\s*\)/);
  });

  it('engine wires all 5 detectors via Promise.allSettled', () => {
    expect(ENGINE).toMatch(/Promise\.allSettled/);
    for (const det of [
      'detectStaleEntity',
      'detectCommitmentDue',
      'detectMoodShift',
      'detectStreakBreak',
      'detectGoalNoProgress',
    ]) {
      expect(ENGINE).toMatch(new RegExp(`${det}\\(\\s*userId\\s*\\)`));
    }
  });

  it('engine wires 4 gates in correct order inside filterCandidates', () => {
    // Find the filterCandidates method implementation with gate calls.
    const filterIdx = ENGINE.indexOf('async filterCandidates(');
    const nextMethodIdx = ENGINE.indexOf('async generateNudge(', filterIdx);
    const body = ENGINE.slice(filterIdx, nextMethodIdx);
    expect(body).toMatch(/gate1_DND/);
    expect(body).toMatch(/gate2_RateLimit/);
    expect(body).toMatch(/gate3_Significance/);
    expect(body).toMatch(/gate4_Dedup/);
    // Verify order: gate1 before gate2, gate2 before gate3, gate3 before gate4
    const idx1 = body.indexOf('gate1_DND');
    const idx2 = body.indexOf('gate2_RateLimit');
    const idx3 = body.indexOf('gate3_Significance');
    const idx4 = body.indexOf('gate4_Dedup');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    expect(idx4).toBeGreaterThan(idx3);
  });

  it('engine persists nudge as Insight with source v2-proactivity', () => {
    expect(ENGINE).toMatch(/persistCandidates\(/);
    expect(ENGINE).toMatch(/source:\s*['"]v2-proactivity['"]/);
  });

  it('per-user engine call is wrapped in try/catch (loop continues on user failure)', () => {
    const userBlock = SCHED.slice(SCHED.indexOf('for (const { id: userId }'));
    const head = userBlock.slice(0, 6000);
    expect(head).toMatch(/getProactivityEngine[\s\S]{0,200}?runForUser/);
    expect(head).toMatch(/\[v2-proactivity\]/);
    expect(head).toMatch(/try\s*\{[\s\S]{0,100}?runForUser[\s\S]{0,100}?catch/);
  });

  it('cron hooks are individually try/catch wrapped (one cron failure cannot break the other)', () => {
    const beforeLoop = SCHED.slice(0, SCHED.indexOf('for (const { id: userId }'));
    const tryCount = (beforeLoop.match(/\btry\s*\{/g) ?? []).length;
    // At minimum: one try per cron hook + any pre-existing ones in tick init.
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
