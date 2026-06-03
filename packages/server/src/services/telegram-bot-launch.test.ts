import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { is409Conflict, launchBackoffMs } from './telegram-bot.js';

describe('is409Conflict — детект конфликта поллеров', () => {
  it('telegraf err.response.error_code 409 → true', () => {
    expect(is409Conflict({ response: { error_code: 409 } })).toBe(true);
  });
  it('текст «409: Conflict: terminated by other getUpdates» → true', () => {
    expect(
      is409Conflict(new Error('409: Conflict: terminated by other getUpdates request')),
    ).toBe(true);
  });
  it('прочая ошибка → false', () => {
    expect(is409Conflict(new Error('ETIMEDOUT'))).toBe(false);
    expect(is409Conflict({ response: { error_code: 401 } })).toBe(false);
    expect(is409Conflict(null)).toBe(false);
  });
});

describe('launchBackoffMs — backoff с капом 60с', () => {
  it('растёт 5s,10s,20s,40s,60s и капается', () => {
    expect(launchBackoffMs(0)).toBe(5_000);
    expect(launchBackoffMs(1)).toBe(10_000);
    expect(launchBackoffMs(2)).toBe(20_000);
    expect(launchBackoffMs(3)).toBe(40_000);
    expect(launchBackoffMs(4)).toBe(60_000);
    expect(launchBackoffMs(10)).toBe(60_000);
  });
});

describe('startBot — авто-ретрай запуска (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf-8');
  it('использует launchWithRetry + setTimeout, не голый launch().catch(log)', () => {
    expect(SRC).toContain('launchWithRetry(bot)');
    expect(SRC).toMatch(/launchWithRetry[\s\S]*?setTimeout[\s\S]*?launchWithRetry/);
    expect(SRC).toContain('is409Conflict');
  });
});
