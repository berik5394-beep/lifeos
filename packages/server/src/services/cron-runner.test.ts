import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldRunCron } from './cron-runner.js';

const SRC = readFileSync(join(__dirname, 'cron-runner.ts'), 'utf8');

describe('shouldRunCron — pure', () => {
  const now = new Date('2026-05-31T12:00:00Z');
  const oneHour = 60 * 60 * 1000;

  it('returns true when never ran (null lastRanAt)', () => {
    expect(shouldRunCron(null, oneHour, now)).toBe(true);
  });
  it('returns false when ran less than interval ago', () => {
    const lastRan = new Date(now.getTime() - oneHour / 2);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(false);
  });
  it('returns true exactly at interval boundary', () => {
    const lastRan = new Date(now.getTime() - oneHour);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(true);
  });
  it('returns true when ran much longer than interval ago', () => {
    const lastRan = new Date(now.getTime() - oneHour * 10);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(true);
  });
  it('returns false defensively on future lastRanAt (clock skew)', () => {
    const future = new Date(now.getTime() + oneHour);
    expect(shouldRunCron(future, oneHour, now)).toBe(false);
  });
  it('uses Date.now() default when called without now arg', () => {
    // Just verify it does not throw and returns a boolean.
    expect(typeof shouldRunCron(null, oneHour)).toBe('boolean');
  });
});

describe('structural — async wrappers', () => {
  it('exports lastRanAt querying prisma.cronJobRun.findFirst', () => {
    expect(SRC).toMatch(/export async function lastRanAt\(/);
    expect(SRC).toMatch(/prisma\.cronJobRun\.findFirst/);
    expect(SRC).toMatch(/orderBy:\s*\{\s*ranAt:\s*'desc'/);
  });
  it('exports recordRun calling prisma.cronJobRun.create', () => {
    expect(SRC).toMatch(/export async function recordRun\(/);
    expect(SRC).toMatch(/prisma\.cronJobRun\.create/);
  });
  it('exports withCronLock that records only on success', () => {
    expect(SRC).toMatch(/export async function withCronLock</);
    // recordRun is called inside try block AFTER fn(); on throw it must NOT be called.
    const fnStartIdx = SRC.indexOf('export async function withCronLock');
    const body = SRC.slice(fnStartIdx);
    const fnCallIdx = body.indexOf('const result = await fn(');
    const recordIdx = body.indexOf('await recordRun(');
    expect(fnCallIdx).toBeGreaterThan(0);
    expect(recordIdx).toBeGreaterThan(fnCallIdx);
  });
  it('withCronLock returns { ran, result? } shape', () => {
    expect(SRC).toMatch(/ran:\s*true/);
    expect(SRC).toMatch(/ran:\s*false/);
  });
  it('withCronLock uses shouldRunCron for the gating decision', () => {
    expect(SRC).toMatch(/shouldRunCron\(\s*last/);
  });
});
