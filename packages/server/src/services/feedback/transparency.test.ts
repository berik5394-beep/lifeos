import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8');

describe('/axes transparency tail', () => {
  it('imports the feedback store', () => {
    expect(BOT).toMatch(/getFeedbackStore/);
  });
  it('renders recent corrections', () => {
    expect(BOT).toMatch(/recentCorrections/);
    expect(BOT).toMatch(/Недавние коррекции/);
  });
});
