import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeToolAction, captureActivity } from './tool-activity-summary.js';

const SRC = readFileSync(join(__dirname, 'tool-activity-summary.ts'), 'utf8');

describe('summarizeToolAction — write tools → {type, content}', () => {
  it('create_task → task_created с title и date', () => {
    const r = summarizeToolAction(
      'create_task',
      { title: 'Купить хлеб', date: '2026-06-02', priority: 'high' },
      { taskId: 't1', message: 'ok' },
      'write',
    );
    expect(r?.type).toBe('task_created');
    expect(r?.content).toContain('Купить хлеб');
    expect(r?.content).toContain('2026-06-02');
  });

  it('complete_task → task_completed', () => {
    const r = summarizeToolAction(
      'complete_task',
      { title: 'Отчёт' },
      { taskId: 't1', message: 'Задача "Отчёт" выполнена ✅' },
      'write',
    );
    expect(r?.type).toBe('task_completed');
    expect(r?.content).toContain('Отчёт');
  });

  it('add_expense → expense_added с суммой и категорией', () => {
    const r = summarizeToolAction(
      'add_expense',
      { amount: 5000, category: 'food', description: 'продукты' },
      { expenseId: 'e1' },
      'write',
    );
    expect(r?.type).toBe('expense_added');
    expect(r?.content).toContain('5000');
    expect(r?.content).toContain('food');
  });

  it('add_income → income_added', () => {
    const r = summarizeToolAction(
      'add_income',
      { amount: 350000, source: 'зарплата' },
      { incomeId: 'i1' },
      'write',
    );
    expect(r?.type).toBe('income_added');
    expect(r?.content).toContain('350000');
    expect(r?.content).toContain('зарплата');
  });

  it('complete_habit → habit_logged', () => {
    const r = summarizeToolAction(
      'complete_habit',
      { name: 'бег' },
      { habitId: 'h1', message: 'Привычка "бег" отмечена ✅' },
      'write',
    );
    expect(r?.type).toBe('habit_logged');
    expect(r?.content).toContain('бег');
  });

  it('complete_multiple_habits → habit_logged со списком имён', () => {
    const r = summarizeToolAction(
      'complete_multiple_habits',
      { habitNames: ['бег', 'медитация'] },
      { count: 2 },
      'write',
    );
    expect(r?.type).toBe('habit_logged');
    expect(r?.content).toContain('бег');
    expect(r?.content).toContain('медитация');
  });

  it('complete_multiple_habits без имён (только ids) → безопасный generic', () => {
    const r = summarizeToolAction(
      'complete_multiple_habits',
      { habitIds: ['h1', 'h2'] },
      { count: 2 },
      'write',
    );
    expect(r?.type).toBe('habit_logged');
    expect(typeof r?.content).toBe('string');
    expect((r?.content ?? '').length).toBeGreaterThan(0);
  });

  it('journal_entry → journal_logged', () => {
    const r = summarizeToolAction(
      'journal_entry',
      { sleepHours: 7, energy: 8, mood: 6 },
      { entryId: 'j1' },
      'write',
    );
    expect(r?.type).toBe('journal_logged');
    expect(r?.content).toContain('7');
  });

  it('create_event → event_created', () => {
    const r = summarizeToolAction(
      'create_event',
      { title: 'Встреча с Сериком', date: '2026-06-03', startTime: '14:00' },
      { eventId: 'ev1', updated: false },
      'write',
    );
    expect(r?.type).toBe('event_created');
    expect(r?.content).toContain('Встреча с Сериком');
    expect(r?.content).toContain('2026-06-03');
  });
});

describe('summarizeToolAction — null cases', () => {
  it('read-инструмент (sideEffects=read) → null даже у известного имени', () => {
    expect(
      summarizeToolAction('get_tasks', { date: '2026-06-01' }, [], 'read'),
    ).toBeNull();
  });

  it('неизвестное имя (write) → null', () => {
    expect(summarizeToolAction('frobnicate', { x: 1 }, {}, 'write')).toBeNull();
  });

  it('external sideEffects → null', () => {
    expect(
      summarizeToolAction('send_telegram', { text: 'hi' }, {}, 'external'),
    ).toBeNull();
  });
});

describe('summarizeToolAction — defensive, never throws', () => {
  it('garbage input не бросает (null/undefined/число вместо объекта)', () => {
    expect(() =>
      summarizeToolAction('create_task', null, null, 'write'),
    ).not.toThrow();
    expect(() =>
      summarizeToolAction('add_expense', 42, undefined, 'write'),
    ).not.toThrow();
    expect(() =>
      summarizeToolAction('create_event', 'str', [], 'write'),
    ).not.toThrow();
    // важно: НЕ бросает — возвращает null или безопасную строку
    const r = summarizeToolAction('create_task', {}, {}, 'write');
    expect(r === null || typeof r.content === 'string').toBe(true);
  });
});

describe('captureActivity — fire-and-forget structural', () => {
  it('captureActivity(null) → no-op (не бросает)', () => {
    expect(() => captureActivity('user-1', null)).not.toThrow();
  });

  it('captureActivity за флагом isV2MemoryEnabled', () => {
    expect(SRC).toMatch(/isV2MemoryEnabled\(/);
  });

  it('recordEvent вызывается fire-and-forget (void + .catch), не await', () => {
    expect(SRC).toMatch(/void recordEvent\(/);
    expect(SRC).toMatch(/void recordEvent\([\s\S]{0,160}\.catch\(/);
    expect(SRC).not.toMatch(/await recordEvent\(/);
  });
});
