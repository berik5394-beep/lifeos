import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldEmbed } from './episodic-memory.js';

const ACTIVITY_SRC = readFileSync(
  join(process.cwd(), 'src/services/tool-activity-summary.ts'),
  'utf-8',
);
const EPISODIC_SRC = readFileSync(
  join(process.cwd(), 'src/services/episodic-memory.ts'),
  'utf-8',
);

describe('M2 — action-события эмбед НЕ требуют (бюджет)', () => {
  it('captureActivity по-прежнему мост через recordEvent (не captureMemory/writeMemory напрямую)', () => {
    expect(ACTIVITY_SRC).toMatch(/void recordEvent\(/);
    expect(ACTIVITY_SRC).not.toMatch(/captureMemory\(/);
    expect(ACTIVITY_SRC).not.toMatch(/writeMemory\(/);
  });

  it('shouldEmbed(action-тип) === false (FTS хватает) — runtime', () => {
    for (const type of [
      'task_created',
      'task_completed',
      'expense_added',
      'income_added',
      'habit_logged',
      'journal_logged',
      'event_created',
    ]) {
      expect(shouldEmbed({ type, content: 'x' })).toBe(false);
    }
  });

  it('EMBED_DEFAULT_TYPES НЕ содержит action-типов (структурно)', () => {
    const start = EPISODIC_SRC.indexOf('const EMBED_DEFAULT_TYPES');
    const block = EPISODIC_SRC.slice(start, start + 400);
    expect(block).not.toContain('task_created');
    expect(block).not.toContain('expense_added');
    expect(block).not.toContain('habit_logged');
  });

  it("'message' эмбедится (recall-ценный чат-факт)", () => {
    expect(shouldEmbed({ type: 'message', content: 'x' })).toBe(true);
  });
});
