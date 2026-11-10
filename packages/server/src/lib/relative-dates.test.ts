import { describe, it, expect } from 'vitest';
import { annotateRelativeDates, relativeLabel } from './relative-dates.js';

/** Berik 2026-11-10: дата хранится числом, «сегодня/завтра/вчера» — при чтении по календарю человека. */
describe('relative-dates', () => {
  it('подписи', () => {
    expect(relativeLabel(0)).toBe('сегодня');
    expect(relativeLabel(1)).toBe('завтра');
    expect(relativeLabel(-1)).toBe('вчера');
    expect(relativeLabel(-9)).toBe('на прошлой неделе');
    expect(relativeLabel(4)).toBe('через 4 дн.');
    expect(relativeLabel(-90)).toBe('3 мес. назад');
  });
  it('9-го сказал «завтра» → в памяти 10 ноября; читаем 10-го — «сегодня», 11-го — «вчера»', () => {
    const mem = 'Собеседование в Kaspi — 10 ноября';
    expect(annotateRelativeDates(mem, '2026-11-09')).toBe('Собеседование в Kaspi — 10 ноября (завтра)');
    expect(annotateRelativeDates(mem, '2026-11-10')).toBe('Собеседование в Kaspi — 10 ноября (сегодня)');
    expect(annotateRelativeDates(mem, '2026-11-11')).toBe('Собеседование в Kaspi — 10 ноября (вчера)');
    expect(annotateRelativeDates(mem, '2026-11-19')).toContain('(на прошлой неделе)');
  });
  it('ISO-даты, год, переход через Новый год, уже подписанное не трогаем', () => {
    expect(annotateRelativeDates('Встреча «X» 2026-11-11', '2026-11-10')).toBe('Встреча «X» 2026-11-11 (завтра)');
    expect(annotateRelativeDates('Отпуск 3 января', '2026-12-30')).toBe('Отпуск 3 января (через 4 дн.)');
    expect(annotateRelativeDates('Купил 28 декабря', '2027-01-02')).toBe('Купил 28 декабря (5 дн. назад)');
    expect(annotateRelativeDates('День 11 ноября (завтра)', '2026-11-10')).toBe('День 11 ноября (завтра)');
    expect(annotateRelativeDates('Без дат, 15 задач', '2026-11-10')).toBe('Без дат, 15 задач');
  });
});
