import { describe, it, expect } from 'vitest';
import { CONSTRAINTS_TEXT } from './capabilities.js';
import { capabilityText } from '../tools/index.js';

/**
 * #5 — список умений/ограничений не должен расходиться с реальностью.
 *
 * SSOT 9B.1: блок ДЕЙСТВИЯ теперь автоген из реестра
 * (`capabilityText()`), рукописный CAPABILITY_TEXT/DOCUMENTED_TOOLS
 * удалён — drift невозможен by design (источник правды — реестр,
 * см. также registry-consistency.test.ts). Здесь проверяем: (1)
 * CONSTRAINTS_TEXT (рукописный, «чего НЕ делаю») честен; (2)
 * capabilityText() выводит поведенческое правило обратимо/confirm
 * АВТОРИТЕТНО из needsConfirm — деньги НЕ в «делай сразу».
 */
describe('CONSTRAINTS_TEXT — честное отрицание (#5/#8)', () => {
  it('честно отрицает покупку/картинки/журнал звонков', () => {
    expect(CONSTRAINTS_TEXT).toMatch(/НЕ покупаешь|не покупаешь/);
    expect(CONSTRAINTS_TEXT).toMatch(/оплачива/);
    expect(CONSTRAINTS_TEXT).toMatch(/картинк/);
    expect(CONSTRAINTS_TEXT).toMatch(/звонк/);
  });
});

describe('capabilityText() — автоген из реестра (#5)', () => {
  it('даёт поведенческое правило обратимо/подтверждение, не пустой', () => {
    const t = capabilityText();
    expect(t.length).toBeGreaterThan(100);
    expect(t).toMatch(/обратим/);
    expect(t).toMatch(/подтвержден/);
  });

  it('деньги (add_expense/add_income) — в confirm-части, НЕ в «делай сразу»', () => {
    const t = capabilityText();
    const split = t.indexOf('Денежные/необратимые');
    expect(split).toBeGreaterThan(0);
    const doNowPart = t.slice(0, split);
    const confirmPart = t.slice(split);
    for (const money of ['add_expense', 'add_income']) {
      expect(confirmPart).toContain(money);
      expect(doNowPart).not.toContain(money);
    }
  });
});
