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
  it('generic fallback для неизвестного tool', () => {
    expect(buildConfirmPrompt('some_new_tool', {})).toMatch(/some_new_tool|действие/i);
  });
  it('не падает на кривых args', () => {
    expect(() => buildConfirmPrompt('set_balance', {})).not.toThrow();
    expect(() => buildConfirmPrompt('log_decision', { title: 123 as never })).not.toThrow();
  });
});
