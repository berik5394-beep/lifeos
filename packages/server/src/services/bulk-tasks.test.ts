import { describe, it, expect } from 'vitest';
import { dayForWeekday, startTimeOf } from './bulk-tasks.js';

describe('расписание с фото: день и время', () => {
  // 2026-11-11 — среда.
  it('день недели → ближайший такой (включая сегодня)', () => {
    expect(dayForWeekday('Среда', '2026-11-11')).toBe('2026-11-11');
    expect(dayForWeekday('пятница', '2026-11-11')).toBe('2026-11-13');
    expect(dayForWeekday('Пн', '2026-11-11')).toBe('2026-11-16');
    expect(dayForWeekday('Sunday', '2026-11-11')).toBe('2026-11-15');
  });
  it('пусто/непонятно → базовый день', () => {
    expect(dayForWeekday('', '2026-11-11')).toBe('2026-11-11');
    expect(dayForWeekday('каждый день', '2026-11-11')).toBe('2026-11-11');
  });
  it('время → начало HH:MM', () => {
    expect(startTimeOf('9:00–10:30')).toBe('09:00');
    expect(startTimeOf('14.05')).toBe('14:05');
    expect(startTimeOf('')).toBeNull();
    expect(startTimeOf('25:00')).toBeNull();
  });
});
