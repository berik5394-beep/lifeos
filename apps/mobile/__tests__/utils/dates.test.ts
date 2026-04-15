import { formatDate, getWeekDays, getMonthKey, isToday, isSameDay } from '@/utils/dates';

describe('formatDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    const date = new Date(2026, 3, 13); // April 13, 2026
    expect(formatDate(date)).toBe('2026-04-13');
  });

  it('pads single-digit month and day with zero', () => {
    const date = new Date(2026, 0, 5); // January 5, 2026
    expect(formatDate(date)).toBe('2026-01-05');
  });

  it('handles December 31', () => {
    const date = new Date(2026, 11, 31);
    expect(formatDate(date)).toBe('2026-12-31');
  });
});

describe('getWeekDays', () => {
  it('returns 7 days starting from Monday', () => {
    // April 13, 2026 is a Monday
    const days = getWeekDays(new Date(2026, 3, 13));
    expect(days).toHaveLength(7);
    expect(days[0].label).toBe('Пн');
    expect(days[6].label).toBe('Вс');
  });

  it('uses Russian day name labels', () => {
    const days = getWeekDays(new Date(2026, 3, 13));
    const labels = days.map((d) => d.label);
    expect(labels).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  });

  it('returns the correct Monday when given a Wednesday', () => {
    // April 15, 2026 is a Wednesday
    const days = getWeekDays(new Date(2026, 3, 15));
    expect(days[0].date.getDate()).toBe(13); // Monday April 13
    expect(days[2].date.getDate()).toBe(15); // Wednesday April 15
  });

  it('returns the correct Monday when given a Sunday', () => {
    // April 19, 2026 is a Sunday
    const days = getWeekDays(new Date(2026, 3, 19));
    expect(days[0].date.getDate()).toBe(13); // Monday April 13
    expect(days[6].date.getDate()).toBe(19); // Sunday April 19
  });

  it('each day has a dayNum property matching date.getDate()', () => {
    const days = getWeekDays(new Date(2026, 3, 13));
    for (const day of days) {
      expect(day.dayNum).toBe(day.date.getDate());
    }
  });
});

describe('getMonthKey', () => {
  it('returns YYYY-MM format', () => {
    expect(getMonthKey(new Date(2026, 3, 13))).toBe('2026-04');
  });

  it('pads single-digit month', () => {
    expect(getMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('handles December', () => {
    expect(getMonthKey(new Date(2026, 11, 25))).toBe('2026-12');
  });
});

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it('returns false for a date in different year', () => {
    expect(isToday(new Date(2020, 0, 1))).toBe(false);
  });
});

describe('isSameDay', () => {
  it('returns true for the same date', () => {
    const a = new Date(2026, 3, 13, 10, 30);
    const b = new Date(2026, 3, 13, 22, 0);
    expect(isSameDay(a, b)).toBe(true);
  });

  it('returns false for different days', () => {
    const a = new Date(2026, 3, 13);
    const b = new Date(2026, 3, 14);
    expect(isSameDay(a, b)).toBe(false);
  });

  it('returns false for same day different month', () => {
    const a = new Date(2026, 3, 13);
    const b = new Date(2026, 4, 13);
    expect(isSameDay(a, b)).toBe(false);
  });

  it('returns false for same day-month different year', () => {
    const a = new Date(2025, 3, 13);
    const b = new Date(2026, 3, 13);
    expect(isSameDay(a, b)).toBe(false);
  });
});
