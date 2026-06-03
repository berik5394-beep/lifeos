import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('telegram /obligations', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf-8');
  it('команда за флагом + listObligations + оба направления', () => {
    expect(src).toContain("bot.command('obligations'");
    expect(src).toContain('isV2ObligationsEnabled');
    expect(src).toContain('listObligations');
    expect(src).toContain('Ты должен:');
    expect(src).toContain('Тебе должны:');
  });
});
