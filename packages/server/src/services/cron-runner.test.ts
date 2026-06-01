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
  it('withCronLock claims atomically (unique lockKey) BEFORE fn — 2.1', () => {
    expect(SRC).toMatch(/export async function withCronLock</);
    const body = SRC.slice(SRC.indexOf('export async function withCronLock'));
    const claimIdx = body.indexOf('cronJobRun.create');
    const fnCallIdx = body.indexOf('const result = await fn(');
    expect(claimIdx).toBeGreaterThan(0);
    // claim ДО fn (атомарность вместо read-then-write гонки)
    expect(fnCallIdx).toBeGreaterThan(claimIdx);
    expect(body).toMatch(/lockKey/);
    // конкурентный claim → P2002 → пропуск
    expect(body).toMatch(/P2002/);
  });
  it('withCronLock освобождает claim если fn бросил (retry next tick)', () => {
    const body = SRC.slice(SRC.indexOf('export async function withCronLock'));
    expect(body).toMatch(/deleteMany\(\{\s*where:\s*\{\s*lockKey/);
  });
  it('withCronLock returns { ran, result? } shape', () => {
    expect(SRC).toMatch(/ran:\s*true/);
    expect(SRC).toMatch(/ran:\s*false/);
  });
  it('withCronLock uses shouldRunCron for the gating decision', () => {
    expect(SRC).toMatch(/shouldRunCron\(\s*last/);
  });
});
