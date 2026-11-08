import { describe, it, expect } from 'vitest';
import { buildConfirmPrompt } from './confirm-prompt.js';

describe('buildConfirmPrompt', () => {
  it('set_balance — со суммой и «да»', () => {
    const s = buildConfirmPrompt('set_balance', { balance: 500000 });
    expect(s).toMatch(/500000/);
    expect(s).toMatch(/да/i);
  });
  it('clear_overdue — про все просроченные', () => {
    expect(buildConfirmPrompt('clear_overdue', {})).toMatch(/просроч/i);
  });
  it('defer_overdue — про перенос', () => {
    expect(buildConfirmPrompt('defer_overdue', {})).toMatch(/перен/i);
  });
  it('log_decision — с заголовком', () => {
    expect(buildConfirmPrompt('log_decision', { title: 'нанять Х' })).toMatch(/нанять Х/);
  });
  it('review_decision — с заголовком', () => {
    expect(
      buildConfirmPrompt('review_decision', { title: 'поставщик A', verdict: 'worked' }),
    ).toMatch(/поставщик A/);
  });
  it('generic fallback — по-русски, БЕЗ сырого имени инструмента (аудит 2026-11-08)', () => {
    const t = buildConfirmPrompt('some_new_tool', {});
    expect(t).toBe('Сделать это? Напиши «да» — выполню.');
    expect(t).not.toContain('some_new_tool');
  });
  it('не падает на кривых args', () => {
    expect(() => buildConfirmPrompt('set_balance', {})).not.toThrow();
    expect(() => buildConfirmPrompt('log_decision', { title: 123 as never })).not.toThrow();
  });
});

import { confirmPromptFor } from './jarvis-orchestrator.js';
describe('confirmPromptFor — деньги человеческим текстом', () => {
  it('delete_expense / add_expense / send_telegram — с суммой и описанием, без имени инструмента', () => {
    expect(confirmPromptFor('delete_expense', { amount: 5000, description: 'обед' })).toBe('Удалить 5000 ₸ (обед)? Подтверди — уберу.');
    expect(confirmPromptFor('add_expense', { amount: 3000, description: 'такси' })).toBe('Записать расход 3000 ₸ (такси)? Подтверди — запишу.');
    expect(confirmPromptFor('send_telegram', { text: 'привет' })).toContain('Отправить тебе в Telegram');
    for (const t of ['delete_expense', 'edit_expense', 'delete_income', 'add_income']) {
      expect(confirmPromptFor(t, { amount: 1 })).not.toContain(t);
    }
  });
  it('остальные confirm-tool — свои тексты (set_balance)', () => {
    expect(confirmPromptFor('set_balance', { balance: 100 })).toContain('Записать текущий баланс 100');
  });
});
