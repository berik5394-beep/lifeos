import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8',
);

describe('telegram-bot.ts — /identity command (E1)', () => {
  it('registers bot.command("identity", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*'identity'/);
  });
  it('reads getBotTraitsStore + generateGrowthNarrative', () => {
    expect(SRC).toContain('getBotTraitsStore');
    expect(SRC).toContain('generateGrowthNarrative');
  });
  it('gated by isV2IdentityEnabled', () => {
    const idx = SRC.indexOf("bot.command('identity'");
    expect(idx).toBeGreaterThan(0);
    const region = SRC.slice(idx, idx + 1500);
    expect(region).toContain('isV2IdentityEnabled');
  });
  it('shows all 4 traits in formatIdentityForTelegram', () => {
    const idx = SRC.indexOf('async function formatIdentityForTelegram');
    expect(idx).toBeGreaterThan(0);
    const region = SRC.slice(idx, idx + 2000);
    expect(region).toContain('warmth');
    expect(region).toContain('directness');
    expect(region).toContain('humor');
    expect(region).toContain('playfulness');
  });
});
