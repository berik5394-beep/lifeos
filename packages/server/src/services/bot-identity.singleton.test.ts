import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-identity.singleton.ts'),
  'utf-8',
);

describe('bot-identity.singleton.ts structural', () => {
  it('exports getBotIdentityService accessor', () => {
    expect(SRC).toMatch(/export function getBotIdentityService/);
  });

  it('exports _resetBotIdentityServiceForTests test helper', () => {
    expect(SRC).toMatch(/export function _resetBotIdentityServiceForTests/);
  });

  it('singleton returns same instance on subsequent calls', async () => {
    const { getBotIdentityService, _resetBotIdentityServiceForTests } = await import(
      './bot-identity.singleton.js'
    );
    _resetBotIdentityServiceForTests();
    expect(getBotIdentityService()).toBe(getBotIdentityService());
  });

  it('_resetBotIdentityServiceForTests yields fresh instance', async () => {
    const { getBotIdentityService, _resetBotIdentityServiceForTests } = await import(
      './bot-identity.singleton.js'
    );
    _resetBotIdentityServiceForTests();
    const a = getBotIdentityService();
    _resetBotIdentityServiceForTests();
    const b = getBotIdentityService();
    expect(a).not.toBe(b);
  });
});
