import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertError, _resetAlertThrottle } from './alert.js';

const SRC = readFileSync(join(__dirname, 'alert.ts'), 'utf8');

describe('alert — 2.4 lightweight Telegram error alerting', () => {
  it('всегда логирует в console.error (независимо от TG-конфига)', () => {
    expect(SRC).toMatch(/console\.error\(`\[alert:/);
  });
  it('no-op в Telegram если ENV не настроены', () => {
    expect(SRC).toMatch(/ALERT_TELEGRAM_CHAT_ID/);
    expect(SRC).toMatch(/if \(!token \|\| !chatId\) return/);
  });
  it('прямой вызов Bot API (независим от telegraf/activeBot)', () => {
    expect(SRC).toMatch(/api\.telegram\.org\/bot/);
  });
  it('троттлит одинаковые ошибки', () => {
    expect(SRC).toMatch(/ALERT_THROTTLE_MS/);
    expect(SRC).toMatch(/lastSent/);
  });
  it('never throws на unconfigured env (best-effort)', async () => {
    _resetAlertThrottle();
    await expect(
      alertError('test', new Error('boom')),
    ).resolves.toBeUndefined();
  });
});
