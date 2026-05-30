import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8',
);

describe('telegram-bot.ts — /axes command (E1)', () => {
  it('registers bot.command("axes", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*'axes'/);
  });
  it('reads from getUserAxesStore', () => {
    expect(SRC).toContain('getUserAxesStore');
    expect(SRC).toMatch(/\.getAxes\(/);
  });
  it('shows recentSignals per axis', () => {
    expect(SRC).toMatch(/recentSignals\(/);
  });
  it('handler gated by isV2AxesEnabled', () => {
    const idx = SRC.indexOf("bot.command('axes'");
    expect(idx).toBeGreaterThan(0);
    const region = SRC.slice(idx, idx + 1500);
    expect(region).toContain('isV2AxesEnabled');
  });
  it('replies with all 4 axis names', () => {
    expect(SRC).toContain('self-discipline');
    expect(SRC).toContain('emotional-openness');
    expect(SRC).toContain('conflict-tolerance');
    expect(SRC).toContain('introspection-depth');
  });
});
