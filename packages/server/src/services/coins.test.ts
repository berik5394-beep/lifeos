import { describe, it, expect } from 'vitest';
import { COIN_REWARD, DAILY_COIN_CAP, cappedAmount, coinKey } from './coins.js';

describe('coins — монеты за дела', () => {
  it('таблица наград по спеке Части 6', () => {
    expect(COIN_REWARD).toMatchObject({ task: 10, habit: 5, journal: 5, day100: 30, start: 200 });
    expect(DAILY_COIN_CAP).toBe(300);
  });
  it('лимит в сутки: не больше остатка, не меньше нуля', () => {
    expect(cappedAmount(10, 0)).toBe(10);
    expect(cappedAmount(10, 295)).toBe(5);
    expect(cappedAmount(10, 300)).toBe(0);
    expect(cappedAmount(10, 999)).toBe(0);
  });
  it('ключи идемпотентности: одно дело — один ключ', () => {
    expect(coinKey.task('t1')).toBe('task:t1');
    expect(coinKey.habit('h1', '2026-11-05')).toBe('habit:h1:2026-11-05');
    expect(coinKey.journal('2026-11-05')).toBe('journal:2026-11-05');
  });
});
