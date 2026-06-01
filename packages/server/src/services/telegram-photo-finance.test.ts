import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf8');

describe('telegram — photo → finance confirm', () => {
  it("registers bot.on('photo')", () => {
    expect(SRC).toMatch(/bot\.on\(\s*['"]photo['"]/);
  });
  it('analyzes finance + sets a PendingAction (no hijack of non-finance)', () => {
    const i = SRC.indexOf("bot.on('photo'");
    const block = SRC.slice(i, i + 1400);
    expect(block).toMatch(/analyzeFinancePhoto/);
    expect(block).toMatch(/buildFinancePending/);
    expect(block).toMatch(/setPendingAction\(/);
  });
});
