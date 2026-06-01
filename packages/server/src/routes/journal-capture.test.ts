import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'journal.ts'), 'utf8');

describe('routes/journal — M1 хук [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST /journal → journal_logged', () => {
    expect(SRC).toMatch(/type:\s*'journal_logged'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
