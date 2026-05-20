import { describe, it, expect } from 'vitest';
import {
  renderCrisisResources,
  RESOURCES_VERIFIED,
  HOTLINES,
} from './crisis-resources.js';

/**
 * Phase 6 C1 — инвариант честности crisis-ресурсов (класс bug #1):
 * непроверенный номер НИКОГДА не доходит до пользователя.
 */

describe('crisis-resources — structural honesty', () => {
  const txt = renderCrisisResources();

  it('всегда содержит безусловно-верное (112) и директиву к помощи', () => {
    expect(txt).toMatch(/112/);
    expect(txt.toLowerCase()).toMatch(/экстренн|психолог|врач/);
  });

  it('всегда содержит «не замена профессиональной помощи»', () => {
    expect(txt.toLowerCase()).toContain('не замена профессиональной');
  });

  it('пока RESOURCES_VERIFIED=false — НИ один пустой hotline не утёк', () => {
    // contact пуст у всех кандидатов → их имена не должны рендериться
    // как «ресурс с номером».
    for (const h of HOTLINES.filter((x) => !x.contact.trim())) {
      expect(txt.includes(`${h.name}:`)).toBe(false);
    }
  });

  it('инвариант: verified=false ИЛИ все HOTLINES имеют contact', () => {
    // Нельзя поставить verified=true, оставив пустые номера.
    if (RESOURCES_VERIFIED) {
      for (const h of HOTLINES) {
        expect(h.contact.trim().length).toBeGreaterThan(0);
      }
    } else {
      expect(RESOURCES_VERIFIED).toBe(false); // ещё не подтверждён Бериком
    }
  });

  // ----- ПОСЛЕ верификации (P0 closed): обязательные инварианты -----
  it('verified=true → render содержит И 112 (emergency) И ≥1 dedicated MH-линию', () => {
    if (!RESOURCES_VERIFIED) return; // условный тест — fires когда verified
    expect(txt).toMatch(/112/); // emergency baseline
    // dedicated MH-линия — любая из подтверждённых (150/111/1303
    // не путаем с 112; должна присутствовать как `name: contact`).
    const hasMh = HOTLINES.some(
      (h) => h.contact.trim().length > 0 && txt.includes(h.contact),
    );
    expect(hasMh, 'нет ни одной dedicated MH-линии в render').toBe(true);
  });

  it('verified=true → каждая подтверждённая HOTLINE отрендерена как «name: contact»', () => {
    if (!RESOURCES_VERIFIED) return;
    for (const h of HOTLINES) {
      expect(txt).toContain(`${h.name}: ${h.contact}`);
    }
  });
});
