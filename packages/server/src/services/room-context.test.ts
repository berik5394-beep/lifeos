import { describe, it, expect } from 'vitest';
import { roomContextFromItems, roomContextLine } from './room-context.js';

describe('roomContextLine — мозг знает, что стоит в комнате робота', () => {
  it('пусто → null (в контекст ничего не пишем)', () => {
    expect(roomContextLine([])).toBeNull();
  });
  it('группирует одинаковые предметы, русские названия', () => {
    expect(roomContextLine(['sofa', 'plant', 'plant', 'lamp'])).toBe('Комната робота: диван, растение ×2, лампа');
  });
  it('мебель для инструментов (Часть 5) — по-русски', () => {
    expect(roomContextLine(['wardrobe', 'desk', 'nightstand', 'dresser'])).toBe('Комната робота: шкаф, стол, тумбочка, комод');
  });
  it('неизвестный ключ пропускается', () => {
    expect(roomContextLine(['sofa', 'rocket'])).toBe('Комната робота: диван');
  });
});

describe('roomContextFromItems — Часть 6: класс ремонта и кладовка', () => {
  it('в ячейках — с классом; кладовка не в счёт; отделка отдельно', () => {
    expect(
      roomContextFromItems([
        { itemKey: 'wardrobe', variantKey: 'mid:wardrobe', slot: 'floor-back-left' },
        { itemKey: 'sofa', variantKey: 'budget:sofa', slot: null },
        { itemKey: 'plant', variantKey: 'free:plant', slot: 'floor-mid-left' },
        { itemKey: 'walls', variantKey: 'luxury:walls', slot: 'finish-walls' },
      ]),
    ).toBe('Комната робота: шкаф-купе (средний), растение; стены — венецианская штукатурка (люкс)');
  });
  it('пусто или всё в кладовке → null', () => {
    expect(roomContextFromItems([])).toBeNull();
    expect(roomContextFromItems([{ itemKey: 'sofa', variantKey: 'budget:sofa', slot: null }])).toBeNull();
  });
  it('старые предметы Части 4 (без варианта) — по старым названиям', () => {
    expect(roomContextFromItems([{ itemKey: 'sofa', variantKey: null, slot: null }])).toBe('Комната робота: диван');
  });
});
