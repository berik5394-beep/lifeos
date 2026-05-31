import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf-8');

describe('/skills command', () => {
  it('registers the skills command', () => {
    expect(BOT).toMatch(/bot\.command\('skills'/);
  });
  it('lists / deletes via the hermes store', () => {
    expect(BOT).toMatch(/getHermesStore/);
    expect(BOT).toMatch(/listSkills/);
    expect(BOT).toMatch(/deleteSkill/);
  });
});
