import { describe, it, expect } from 'vitest';
import {
  FLOOR_SLOTS,
  ROOM_TIERS,
  ROOM_VARIANTS,
  WALL_SLOTS,
  fitsSlot,
  legacyVariantKey,
  slotsFor,
  variantByKey,
} from './room-catalog.js';

describe('каталог ремонта (Часть 6)', () => {
  it('4 класса × 10 вариантов, ключи уникальны', () => {
    for (const t of ROOM_TIERS) expect(ROOM_VARIANTS.filter((v) => v.tier === t)).toHaveLength(10);
    expect(new Set(ROOM_VARIANTS.map((v) => v.key)).size).toBe(ROOM_VARIANTS.length);
  });
  it('цены в диапазонах спеки и растут по классам для каждого вида', () => {
    const range = { budget: [40, 120], mid: [200, 450], premium: [700, 1400], luxury: [2500, 6000] } as const;
    for (const v of ROOM_VARIANTS) {
      if (v.tier === 'free') {
        expect(v.price).toBe(0);
        continue;
      }
      expect(v.price).toBeGreaterThanOrEqual(range[v.tier][0]);
      expect(v.price).toBeLessThanOrEqual(range[v.tier][1]);
    }
    const kinds = new Set(ROOM_VARIANTS.filter((v) => v.tier !== 'free').map((v) => v.kind));
    for (const k of kinds) {
      const prices = ROOM_TIERS.map((t) => variantByKey(`${t}:${k}`)!.price);
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    }
  });
  it('стены и пол — дороже мебели своего класса', () => {
    for (const t of ROOM_TIERS) {
      const of = ROOM_VARIANTS.filter((v) => v.tier === t);
      const finish = Math.min(...of.filter((v) => v.spot === 'finish').map((v) => v.price));
      const furniture = Math.max(...of.filter((v) => v.spot !== 'finish').map((v) => v.price));
      expect(finish).toBeGreaterThan(furniture);
    }
  });
  it('совместимость ячеек: часы — стена, шкаф — пол, отделка — своя', () => {
    const clock = variantByKey('mid:clock')!;
    const wardrobe = variantByKey('mid:wardrobe')!;
    expect(slotsFor(clock)).toEqual(WALL_SLOTS);
    expect(slotsFor(wardrobe)).toEqual(FLOOR_SLOTS);
    expect(fitsSlot(clock, 'floor-back-left')).toBe(false);
    expect(fitsSlot(wardrobe, 'wall-left')).toBe(false);
    expect(slotsFor(variantByKey('premium:walls')!)).toEqual(['finish-walls']);
    expect(fitsSlot(variantByKey('premium:floor')!, 'finish-walls')).toBe(false);
  });
  it('старая мебель Части 4 → бюджет / декор', () => {
    expect(legacyVariantKey('sofa')).toBe('budget:sofa');
    expect(legacyVariantKey('plant')).toBe('free:plant');
    expect(legacyVariantKey('rocket')).toBeNull();
  });
});
