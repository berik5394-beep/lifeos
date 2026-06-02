import { describe, it, expect } from 'vitest';
import { availableMinutesToday } from './_slots.js';

const ev = (startTime: string, endTime: string) => ({ startTime, endTime });

describe('availableMinutesToday — свободные минуты сегодня', () => {
  it('нет событий, сейчас 09:00 → полное окно 09:00–20:00 = 660', () => {
    expect(availableMinutesToday([], '09:00')).toBe(660);
  });
  it('сейчас 18:00, нет событий → 120', () => {
    expect(availableMinutesToday([], '18:00')).toBe(120);
  });
  it('встреча 14:00–15:00, сейчас 09:00 → 600', () => {
    expect(availableMinutesToday([ev('14:00', '15:00')], '09:00')).toBe(600);
  });
  it('прошедшее событие игнорируется (10:00–11:00, сейчас 12:00) → 480', () => {
    expect(availableMinutesToday([ev('10:00', '11:00')], '12:00')).toBe(480);
  });
  it('после окна (21:00) → 0', () => {
    expect(availableMinutesToday([], '21:00')).toBe(0);
  });
  it('событие частично до «сейчас» (11:30–13:00, сейчас 12:00) → урезается до 12:00–13:00', () => {
    // окно 12:00–20:00 = 480; минус 12:00–13:00 (60) = 420
    expect(availableMinutesToday([ev('11:30', '13:00')], '12:00')).toBe(420);
  });
});
