import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/index.ts'),
  'utf-8',
);

describe('bot-traits/index.ts structural', () => {
  it('exports getBotTraitsStore', () => {
    expect(SRC).toMatch(/export function getBotTraitsStore/);
  });
  it('exports _resetBotTraitsForTests', () => {
    expect(SRC).toMatch(/export function _resetBotTraitsForTests/);
  });
  it('re-exports BotTraitsStore type + PostgresBotTraits', () => {
    expect(SRC).toContain('BotTraitsStore');
    expect(SRC).toContain('PostgresBotTraits');
  });
  it('singleton returns same instance', async () => {
    const { getBotTraitsStore, _resetBotTraitsForTests } = await import('./index.js');
    _resetBotTraitsForTests();
    const a = getBotTraitsStore();
    const b = getBotTraitsStore();
    expect(a).toBe(b);
  });
  it('_resetBotTraitsForTests creates fresh instance', async () => {
    const { getBotTraitsStore, _resetBotTraitsForTests } = await import('./index.js');
    _resetBotTraitsForTests();
    const a = getBotTraitsStore();
    _resetBotTraitsForTests();
    const b = getBotTraitsStore();
    expect(a).not.toBe(b);
  });
});
