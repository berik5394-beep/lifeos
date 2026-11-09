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

describe('summarizeToolAction — все write-инструменты и честность', () => {
  it('инструмент не сделал дело (error / notFound / ok:false / выключен) → в память НЕ пишем', () => {
    expect(summarizeToolAction('complete_task', { title: 'отчёт' }, { message: 'Задача не найдена', notFound: true }, 'write')).toBeNull();
    expect(summarizeToolAction('log_decision', { title: 'x' }, { error: 'функция отключена' }, 'write')).toBeNull();
    expect(summarizeToolAction('cancel_obligation', { id: '1' }, { error: 'обязательство не найдено' }, 'write')).toBeNull();
    expect(summarizeToolAction('set_budget', { category: 'food', monthlyLimit: 1 }, { ok: false }, 'write')).toBeNull();
  });
  it('complete_multiple_habits: ненайденные привычки не попадают в «отметил»', () => {
    const s = summarizeToolAction('complete_multiple_habits', { habitNames: ['зарядка', 'полёт на луну'] }, { notFoundNames: ['полёт на луну'] }, 'write');
    expect(s?.content).toBe('Отметил привычки: зарядка');
  });
  it('лимиты, сделки, долги, цели, решения, баланс — теперь в памяти', () => {
    expect(summarizeToolAction('set_budget', { category: 'food', monthlyLimit: 90000 }, { ok: true }, 'write')?.content).toBe('Лимит бюджета · food: 90 000 ₸');
    expect(summarizeToolAction('create_deal', { title: 'Окна', personName: 'Серик', amount: 500000 }, {}, 'write')?.content).toBe('Сделка «Окна» с Серик 500 000 ₸');
    expect(summarizeToolAction('update_deal', { personName: 'Серик', stage: 'won' }, {}, 'write')?.content).toBe('Сделка «Серик» → «Выиграна»');
    expect(summarizeToolAction('create_obligation', { personName: 'Айдар', direction: 'i_owe', amount: 20000 }, {}, 'write')?.content).toBe('Долг (я должен): Айдар 20 000 ₸');
    expect(summarizeToolAction('settle_obligation', { id: '1' }, { ok: true, settled: true, proposeFinance: { who: 'Айдар', amount: 20000 } }, 'write')?.content).toBe('Закрыл долг · Айдар 20 000 ₸');
    expect(summarizeToolAction('create_weekly_goal', { goalText: 'прочитать книгу' }, {}, 'write')?.type).toBe('weekly_goal_created');
    expect(summarizeToolAction('log_goal_progress', { goalQuery: 'книги', percent: 40 }, {}, 'write')?.content).toBe('Прогресс цели «книги»: 40%');
    expect(summarizeToolAction('log_decision', { title: 'сменить работу' }, { ok: true }, 'write')?.type).toBe('decision_logged');
    expect(summarizeToolAction('set_balance', { balance: 350000 }, { ok: true }, 'write')?.content).toBe('Баланс на руках: 350 000 ₸');
    expect(summarizeToolAction('cancel_task', { title: 'купить хлеб' }, {}, 'write')?.content).toBe('Отменил задачу «купить хлеб»');
  });
  it('граф людей пишет память сам — здесь не дублируем', () => {
    expect(summarizeToolAction('remember_entity', { name: 'мама' }, {}, 'write')).toBeNull();
    expect(summarizeToolAction('link_relationship', { fromName: 'я', toName: 'мама' }, {}, 'write')).toBeNull();
  });
});

describe('аудит 2026-11-09: вопрос/ожидание «да» — не дело, в память не пишем', () => {
  it('suggest_goal с pending (ещё не «да») → null', () => {
    expect(summarizeToolAction('suggest_goal', { goalText: 'машина' }, { message: 'Поставить цель?', pending: true }, 'write')).toBeNull();
  });
  it('log_goal_progress «Не нашёл цель» (needsInput) → null', () => {
    expect(summarizeToolAction('log_goal_progress', { goalQuery: 'чтение' }, { message: 'Не нашёл…', needsInput: true }, 'write')).toBeNull();
  });
  it('complete_task по id → название из ответа, а не id', () => {
    expect(summarizeToolAction('complete_task', { taskId: 'clx123' }, { message: 'Задача «Отчёт» выполнена ✅' }, 'write')?.content).toBe('Выполнил задачу «Отчёт»');
  });
  it('move_task — в память', () => {
    expect(summarizeToolAction('move_task', { title: 'Звонок', newDate: '2026-11-10' }, { message: 'ok', taskId: 't' }, 'write')?.content).toBe('Перенёс задачу «Звонок» на 2026-11-10');
  });
});
