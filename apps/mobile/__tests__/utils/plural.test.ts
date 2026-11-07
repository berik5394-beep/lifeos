import { pluralN, DAYS, RECORDS } from '@/utils/plural';

describe('склонение', () => {
  it.each([
    [1, '1 день'], [2, '2 дня'], [5, '5 дней'], [11, '11 дней'], [21, '21 день'], [22, '22 дня'], [112, '112 дней'], [0, '0 дней'],
  ])('%i → %s', (n, s) => expect(pluralN(n, DAYS)).toBe(s));
  it('записи', () => {
    expect(pluralN(1, RECORDS)).toBe('1 запись');
    expect(pluralN(3, RECORDS)).toBe('3 записи');
  });
});
