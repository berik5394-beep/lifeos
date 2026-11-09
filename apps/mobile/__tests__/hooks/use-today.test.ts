import { dayKey, msUntilNextDay } from '@/hooks/use-today';

/** Аудит 2026-11-09: «сегодня» вкладки переходит само в полночь. */
describe('useToday — части', () => {
  it('dayKey — локальная дата', () => {
    expect(dayKey(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09');
    expect(dayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
  it('таймер — до начала следующего дня (+1 с)', () => {
    expect(msUntilNextDay(new Date(2026, 10, 9, 23, 59, 0))).toBe(61_000);
    expect(msUntilNextDay(new Date(2026, 11, 31, 12, 0, 0))).toBe(12 * 3600_000 + 1000);
  });
});
