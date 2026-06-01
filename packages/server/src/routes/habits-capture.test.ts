import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'habits.ts'), 'utf8');

describe('routes/habits — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST /habits → habit_created', () => {
    expect(SRC).toMatch(/type:\s*'habit_created'/);
  });
  it('PUT /habits/:id → habit_updated', () => {
    expect(SRC).toMatch(/type:\s*'habit_updated'/);
  });
  it('POST /habits/:id/log → habit_logged', () => {
    expect(SRC).toMatch(/type:\s*'habit_logged'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
