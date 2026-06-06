import { describe, it, expect } from 'vitest';
import { minToHM, itemWindow, intervalsOverlap, findOverlaps, formatCreationConflict, type SchedItem } from './types.js';

describe('minToHM / itemWindow', () => {
  it('minToHM', () => {
    expect(minToHM(840)).toBe('14:00');
    expect(minToHM(905)).toBe('15:05');
    expect(minToHM(0)).toBe('00:00');
  });
  it('task = точка [t,t+1); event = [start,end||start+60)', () => {
    expect(itemWindow('task', '14:00', null)).toEqual({ startMin: 840, endMin: 841 });
    expect(itemWindow('event', '14:00', '15:00')).toEqual({ startMin: 840, endMin: 900 });
    expect(itemWindow('event', '14:00', null)).toEqual({ startMin: 840, endMin: 900 });
    expect(itemWindow('task', 'bad', null)).toBeNull();
  });
});

describe('intervalsOverlap / findOverlaps', () => {
  it('пересечение полуоткрытых интервалов', () => {
    expect(intervalsOverlap(840, 841, 840, 900)).toBe(true); // задача 14:00 ∩ встреча 14-15
    expect(intervalsOverlap(900, 901, 840, 900)).toBe(false); // задача 15:00 — конец эксклюзивен
    expect(intervalsOverlap(840, 900, 860, 920)).toBe(true); // событие 14-15 ∩ 14:20-15:20
  });
  it('ТВОЙ КЕЙС: новая задача 14:00 пересекает встречу Серик 14:00–15:00', () => {
    const newItem: SchedItem = { title: 'Сходить в зал', kind: 'task', startMin: 840, endMin: 841 };
    const others: SchedItem[] = [{ title: 'Серик', kind: 'event', startMin: 840, endMin: 900 }];
    expect(findOverlaps(newItem, others)).toHaveLength(1);
  });
  it('нет пересечения (задача 09:00)', () => {
    const newItem: SchedItem = { title: 'X', kind: 'task', startMin: 540, endMin: 541 };
    const others: SchedItem[] = [{ title: 'Серик', kind: 'event', startMin: 840, endMin: 900 }];
    expect(findOverlaps(newItem, others)).toHaveLength(0);
  });
});

describe('formatCreationConflict', () => {
  it('пересечение → inline-предупреждение «не успеешь»', () => {
    const s = formatCreationConflict([{ title: 'Серик', kind: 'event', startMin: 840, endMin: 900 }]);
    expect(s).toContain('⚠️');
    expect(s).toContain('не успеешь');
    expect(s).toContain('встреча «Серик» 14:00–15:00');
  });
  it('пусто → пустая строка', () => {
    expect(formatCreationConflict([])).toBe('');
  });
});
