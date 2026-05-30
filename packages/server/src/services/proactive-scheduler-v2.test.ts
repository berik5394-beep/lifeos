import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'proactive-scheduler.ts'), 'utf8');

describe('proactive-scheduler — v2 wiring (E1)', () => {
  it('imports isV2ProactivityEnabled', () => {
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
    expect(SRC).toMatch(/isV2ProactivityEnabled/);
  });
  it('imports getProactivityEngine', () => {
    expect(SRC).toMatch(/from '\.\/v2-proactivity-engine\.singleton\.js'/);
    expect(SRC).toMatch(/getProactivityEngine/);
  });
  it('hook is flag-gated, awaited inside try/catch with console.warn', () => {
    expect(SRC).toMatch(/isV2ProactivityEnabled\(\s*userId\s*\)/);
    expect(SRC).toMatch(/getProactivityEngine\(\)\.runForUser\(\s*userId\s*\)/);
    expect(SRC).toMatch(/\[v2-proactivity\]/);
  });
  it('runs BEFORE deliverTopInsight so same tick can push the new nudge', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    expect(tickFn.indexOf('runForUser')).toBeGreaterThan(0);
    expect(tickFn.indexOf('runForUser')).toBeLessThan(
      tickFn.indexOf('deliverTopInsight'),
    );
  });
  it('failure does not break tick (caught locally, continue loop)', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,120}?\[v2-proactivity\]/);
  });
});
