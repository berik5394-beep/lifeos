import { greetingForHour } from '@/utils/greeting';

describe('greetingForHour', () => {
  it.each([
    [7, 'Доброе утро'],
    [13, 'Добрый день'],
    [17, 'Добрый день'],
    [20, 'Добрый вечер'],
    [2, 'Доброй ночи'],
  ])('%i ч → %s', (h, want) => {
    expect(greetingForHour(h)).toBe(want);
  });
});
