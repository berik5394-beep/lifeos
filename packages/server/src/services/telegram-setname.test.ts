import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'telegram-bot.ts'), 'utf8');

describe('telegram /setname command', () => {
  it('registers bot.command("setname", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*['"]setname['"]/);
  });
  it('parses the argument from ctx.message.text', () => {
    expect(SRC).toMatch(/ctx\.message\.text/);
    expect(SRC).toMatch(/\.split\(['"] ['"]\)|split\(\/ \/\)/);
  });
  it('enforces 1-30 char validation', () => {
    expect(SRC).toMatch(/Использование:\s*\/setname Имя/);
    expect(SRC).toMatch(/слишком длинн|макс\s*30|>\s*30/);
  });
  it('imports + calls getBotIdentityService().updateIdentity with botName', () => {
    expect(SRC).toMatch(/from '\.\/bot-identity\.singleton\.js'/);
    expect(SRC).toMatch(/getBotIdentityService\(\)\.updateIdentity\(/);
    expect(SRC).toMatch(/botName:/);
  });
  it('confirms with «Готово, теперь меня зовут ...»', () => {
    expect(SRC).toMatch(/Готово, теперь меня зовут/);
  });
  it('reuses existing findOrCreateUser (no duplicate user-resolution path)', () => {
    const handler = SRC.slice(
      SRC.indexOf("bot.command('setname'"),
      SRC.indexOf("bot.command('setname'") + 1500,
    );
    expect(handler).toMatch(/findOrCreateUser\(/);
  });
});
