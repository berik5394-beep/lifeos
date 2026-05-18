import { describe, it, expect } from 'vitest';
import { CAPABILITY_TEXT, CONSTRAINTS_TEXT } from './capabilities.js';

/**
 * SSOT 9A.8: LOCAL_TOOLS удалён — старый drift-guard
 * (LOCAL_TOOLS↔DOCUMENTED_TOOLS) снят. Его роль теперь у
 * registry-consistency.test.ts (источник правды — реестр).
 * CAPABILITY_TEXT/CONSTRAINTS_TEXT пока рукописные — автоген из
 * реестра запланирован в 9B; здесь остаётся проверка их
 * содержания (честность ограничений, ключевые умения).
 */
describe('capabilities text — честность (до 9B-автогена)', () => {
  it('CONSTRAINTS честно отрицает покупку/картинки/журнал звонков (#5/#8)', () => {
    expect(CONSTRAINTS_TEXT).toMatch(/НЕ покупаешь|не покупаешь/);
    expect(CONSTRAINTS_TEXT).toMatch(/оплачива/);
    expect(CONSTRAINTS_TEXT).toMatch(/картинк/);
    expect(CONSTRAINTS_TEXT).toMatch(/звонк/);
  });

  it('CAPABILITY покрывает ключевое (поездки, подтверждение денег)', () => {
    expect(CAPABILITY_TEXT).toMatch(/поездк/);
    expect(CAPABILITY_TEXT).toMatch(/подтвержден/);
    expect(CAPABILITY_TEXT.length).toBeGreaterThan(100);
  });
});
