import { INTRO_STEPS, furnitureBadge, isIntroDone, markIntroDone } from '@/services/room-intro';

describe('room-intro — знакомство и значки на мебели', () => {
  it('тур короткий, начинается приветствием и показывает разговор, инструменты, мебель, «Обставить»', () => {
    expect(INTRO_STEPS.length).toBeLessThanOrEqual(7);
    expect(INTRO_STEPS[0].target).toBe('none');
    const targets = INTRO_STEPS.map((s) => s.target);
    for (const t of ['input', 'tools', 'furniture', 'furnish', 'icons'] as const) expect(targets).toContain(t);
    for (const s of INTRO_STEPS) expect(s.text.length).toBeLessThan(160);
  });
  it('флаг «тур пройден» сохраняется', () => {
    expect(isIntroDone()).toBe(false);
    markIntroDone();
    expect(isIntroDone()).toBe(true);
  });
  it('значок на мебели: что лежит внутри; скрытые инструменты не показываем', () => {
    expect(furnitureBadge('wardrobe')).toBe('🎯📅');
    expect(furnitureBadge('desk')).toBe('✅💼');
    // сделки выключены на сервере → на столе только задачи
    expect(furnitureBadge('desk', ['tasks'])).toBe('✅');
    expect(furnitureBadge('sofa')).toBe('');
    expect(furnitureBadge('wardrobe', ['calendar'])).toBe('📅');
  });
});
