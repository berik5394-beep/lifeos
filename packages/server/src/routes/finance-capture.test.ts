import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'finance.ts'), 'utf8');

describe('routes/finance — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST /finance/expenses → expense_added', () => {
    expect(SRC).toMatch(/type:\s*'expense_added'/);
  });
  it('POST /finance/incomes → income_added', () => {
    expect(SRC).toMatch(/type:\s*'income_added'/);
  });
  it('POST /finance/budget → budget_set', () => {
    expect(SRC).toMatch(/type:\s*'budget_set'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
