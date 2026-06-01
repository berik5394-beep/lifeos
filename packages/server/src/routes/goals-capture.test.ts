import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'goals.ts'), 'utf8');

describe('routes/goals — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST weekly → weekly_goal_created', () => {
    expect(SRC).toMatch(/type:\s*'weekly_goal_created'/);
  });
  it('PUT weekly → weekly_goal_updated', () => {
    expect(SRC).toMatch(/type:\s*'weekly_goal_updated'/);
  });
  it('POST yearly → yearly_goal_created', () => {
    expect(SRC).toMatch(/type:\s*'yearly_goal_created'/);
  });
  it('PUT yearly → yearly_goal_updated', () => {
    expect(SRC).toMatch(/type:\s*'yearly_goal_updated'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
