import { describe, it, expect } from 'vitest';
import { disclaimerShort, disclaimerFull } from './disclaimer.js';

/**
 * Phase 6 C1 — инварианты дисклеймера. Главный (юр./культурный,
 * провал-инвариант спеки): LifeOS НЕ называет СЕБЯ психологом/
 * терапевтом. Направить к специалисту — можно.
 */

describe('disclaimer — позиционирование «друг, не психолог»', () => {
  const s = disclaimerShort();
  const f = disclaimerFull();

  it('SHORT: «не замена профессиональной» + «AI-друг»', () => {
    expect(s.toLowerCase()).toContain('не замена профессиональной');
    expect(s.toLowerCase()).toContain('ai-друг');
  });

  it('НЕ называет СЕБЯ психологом/терапевтом (self-label запрещён)', () => {
    for (const t of [s, f]) {
      const x = t.toLowerCase();
      // Cyrillic-safe boundary: «я» как СЛОВО (местоимение), не
      // окончание «лини-я психологической». Без \b (ASCII-only).
      expect(x).not.toMatch(/(?:^|[^а-яё])я\s+психолог/);
      expect(x).not.toMatch(/(?:^|[^а-яё])я\s+терапевт/);
      expect(x).not.toMatch(/твой\s+(психолог|терапевт)/);
      expect(x).not.toContain('ai-психолог');
      expect(x).not.toContain('ai-терапевт');
    }
  });

  it('FULL = SHORT + ресурсы (единый источник, без дубля 112)', () => {
    expect(f.startsWith(disclaimerShort())).toBe(true);
    expect(f).toMatch(/112/); // из renderCrisisResources, не из SHORT-копии
    // 112 встречается ровно один раз (нет дубля SSOT-нарушения)
    expect((f.match(/112/g) ?? []).length).toBe(1);
  });

  it('UX-дедуп: «не замена профессиональной помощи» в FULL РОВНО раз', () => {
    // SHORT уже содержит фразу; ресурс-блок в FULL рендерится с
    // omitTailDisclaimer → повтора нет. Регресс дедупа = красный.
    const occ = (f.match(/не замена профессиональной помощи/g) ?? [])
      .length;
    expect(occ).toBe(1);
  });

  it('детерминирован', () => {
    expect(disclaimerShort()).toBe(s);
    expect(disclaimerFull()).toBe(f);
  });
});
