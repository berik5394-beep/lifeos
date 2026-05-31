import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'),
  'utf-8',
);

describe('proactive-scheduler — bot-traits-snapshot cron (E2)', () => {
  it('imports getBotTraitsStore', () => {
    expect(SRC).toContain('getBotTraitsStore');
  });
  it('uses withCronLock with bot-traits-snapshot job name + weekly interval', () => {
    expect(SRC).toMatch(/withCronLock\(\s*['"]bot-traits-snapshot['"]/);
    expect(SRC).toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
  it('refreshTraits + snapshot per user', () => {
    const idx = SRC.indexOf('bot-traits-snapshot');
    const body = SRC.slice(Math.max(0, idx - 200), idx + 1200);
    expect(body).toContain('refreshTraits');
    expect(body).toContain('snapshot');
  });
  it('gated by isV2CronEnabled', () => {
    const idx = SRC.indexOf('bot-traits-snapshot');
    const window = SRC.slice(Math.max(0, idx - 1500), idx + 200);
    expect(window).toContain('isV2CronEnabled');
  });
});
