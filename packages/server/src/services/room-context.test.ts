import { describe, it, expect } from 'vitest';
import { roomContextLine } from './room-context.js';

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
