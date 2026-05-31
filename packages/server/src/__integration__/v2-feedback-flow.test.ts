import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAP = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'),
  'utf-8');
const BOT = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8');
const IMPL = readFileSync(
  join(process.cwd(), 'src/services/feedback/postgres-impl.ts'), 'utf-8');

describe('v2 feedback flow — inbound capture', () => {
  it('feedback branch gated + full pipeline wired', () => {
    expect(CAP).toContain('isV2FeedbackEnabled');
    expect(CAP).toContain('classifyFeedback');
    expect(CAP).toContain('applyFeedback');
  });
});

describe('v2 feedback flow — corrections route through B1 axes', () => {
  it('applyFeedback records signals with source feedback (not B2 traits)', () => {
    expect(IMPL).toMatch(/recordSignals\([^)]*'feedback'/s);
    expect(IMPL).not.toMatch(/refreshTraits|BotIdentity/);
  });
});

describe('v2 feedback flow — transparency', () => {
  it('/axes renders recent corrections', () => {
    expect(BOT).toContain('recentCorrections');
  });
});
