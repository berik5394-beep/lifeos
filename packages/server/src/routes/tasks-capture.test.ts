import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'tasks.ts'), 'utf8');

describe('routes/tasks — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST /tasks → task_created', () => {
    expect(SRC).toMatch(
      /captureActivity\(\s*request\.userId,\s*\{\s*type:\s*'task_created'/,
    );
  });
  it('PATCH complete toggle → task_completed и task_reopened', () => {
    expect(SRC).toMatch(/'task_completed'/);
    expect(SRC).toMatch(/'task_reopened'/);
  });
  it('PUT /tasks/:id → task_updated', () => {
    expect(SRC).toMatch(/type:\s*'task_updated'/);
  });
  it('PATCH kanban → task_kanban_moved', () => {
    expect(SRC).toMatch(/type:\s*'task_kanban_moved'/);
  });
  it('captureActivity не await-ится (fire-and-forget)', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
