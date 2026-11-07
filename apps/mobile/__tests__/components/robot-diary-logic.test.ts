import { diaryDayLabel } from '@/components/memory/robot-diary-logic';

describe('дневник робота: подпись дня', () => {
  const now = new Date(2026, 10, 7, 20, 0);
  it('сегодня / вчера', () => {
    expect(diaryDayLabel('2026-11-07', now)).toBe('Сегодня');
    expect(diaryDayLabel('2026-11-06', now)).toBe('Вчера');
  });
  it('дальше — день недели и дата, другой год — с годом', () => {
    expect(diaryDayLabel('2026-11-04', now)).toBe('Среда, 4 ноября');
    expect(diaryDayLabel('2025-12-31', now)).toBe('Среда, 31 декабря 2025');
  });
  it('кривая дата — как есть', () => {
    expect(diaryDayLabel('мусор', now)).toBe('мусор');
  });
});
