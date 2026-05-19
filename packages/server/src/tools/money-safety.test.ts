import { describe, it, expect } from 'vitest';
import {
  registry,
  toolConfirmRequired,
  confirmAlwaysNames,
  insightApplyDecision,
} from './index.js';

/**
 * SSOT invariant — money-safety. Гейт подтверждения ЖИВЁТ НА
 * ИНСТРУМЕНТЕ (не в глобальном NEEDS_CONFIRM). Деньги обязаны
 * требовать confirm; обратимые write — нет. Если кто-то снимет
 * needsConfirm с add_expense — этот тест покраснеет.
 */

describe('add_expense / add_income — деньги, gated', () => {
  it.each(['add_expense', 'add_income'])(
    '%s: в реестре, needsConfirm=true, finance/write',
    (n) => {
      const t = registry.get(n);
      expect(t, `${n} в реестре`).toBeDefined();
      expect(t!.needsConfirm).toBe(true);
      expect(t!.category).toBe('finance');
      expect(t!.sideEffects).toBe('write');
    },
  );

  it('toolConfirmRequired: деньги → true', () => {
    expect(toolConfirmRequired('add_expense', { amount: 5000 })).toBe(true);
    expect(toolConfirmRequired('add_income', { amount: 150000 })).toBe(true);
  });

  it('обратимые write НЕ требуют confirm (гейт селективен)', () => {
    expect(toolConfirmRequired('create_task', { title: 'x', date: '2026-05-20' })).toBe(false);
    expect(toolConfirmRequired('complete_habit', { name: 'бег' })).toBe(false);
  });

  it('confirmAlwaysNames содержит деньги, НЕ содержит create_task', () => {
    const names = confirmAlwaysNames();
    expect(names).toContain('add_expense');
    expect(names).toContain('add_income');
    expect(names).not.toContain('create_task');
  });

  it('неизвестный tool → toolConfirmRequired false (нет в реестре)', () => {
    expect(toolConfirmRequired('totally_unknown_xyz', {})).toBe(false);
  });

  it('send_telegram (9B.2) — в реестре, external, needsConfirm=true', () => {
    const t = registry.get('send_telegram');
    expect(t, 'send_telegram в реестре').toBeDefined();
    expect(t!.needsConfirm).toBe(true);
    expect(t!.sideEffects).toBe('external');
    expect(toolConfirmRequired('send_telegram', { text: 'hi' })).toBe(true);
    expect(confirmAlwaysNames()).toContain('send_telegram');
  });
});

describe('money zod-схемы', () => {
  it('add_expense: {amount} ок; отриц./0/без amount — нет', () => {
    const s = registry.get('add_expense')!.schema;
    expect(s.safeParse({ amount: 40000 }).success).toBe(true);
    expect(
      s.safeParse({ amount: 40000, category: 'transfer', description: 'Kaspi' })
        .success,
    ).toBe(true);
    expect(s.safeParse({ amount: -5 }).success).toBe(false);
    expect(s.safeParse({ amount: 0 }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });

  it('add_income: {amount(+source?)} ок; без amount — нет', () => {
    const s = registry.get('add_income')!.schema;
    expect(s.safeParse({ amount: 150000 }).success).toBe(true);
    expect(s.safeParse({ amount: 150000, source: 'зарплата' }).success).toBe(true);
    expect(s.safeParse({ source: 'зарплата' }).success).toBe(false);
  });
});

describe('P3/R8 — insightApplyDecision security invariant', () => {
  it('деньги/внешнее → confirm (НИКОГДА авто из рефлектора)', () => {
    expect(insightApplyDecision('add_expense', { amount: 5000 })).toBe(
      'confirm',
    );
    expect(insightApplyDecision('add_income', { amount: 150000 })).toBe(
      'confirm',
    );
    expect(insightApplyDecision('send_telegram', { text: 'hi' })).toBe(
      'confirm',
    );
  });
  it('обратимое → execute (с аудитом)', () => {
    expect(
      insightApplyDecision('create_task', { title: 'x', date: '2026-05-20' }),
    ).toBe('execute');
    expect(insightApplyDecision('complete_habit', { name: 'бег' })).toBe(
      'execute',
    );
  });
  it('неизвестное действие → reject (честный отказ, не выдумка)', () => {
    expect(insightApplyDecision('totally_unknown_xyz', {})).toBe('reject');
  });
  it('инвариант: ВСЕ confirmAlwaysNames → confirm (не execute)', () => {
    for (const n of confirmAlwaysNames()) {
      expect(insightApplyDecision(n, {})).toBe('confirm');
    }
  });
});
