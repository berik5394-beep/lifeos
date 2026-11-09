import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('./proactive-notifications.js', () => ({ buildMorning: vi.fn() }));
vi.mock('./morning-brief.js', () => ({ composeMorningBrief: vi.fn() }));

const { greetingForHour } = await import('./today-brief.js');

describe('greetingForHour — приветствие брифа по часу юзера', () => {
  it.each([
    [5, 'Доброе утро'],
    [11, 'Доброе утро'],
    [12, 'Добрый день'],
    [17, 'Добрый день'],
    [18, 'Добрый вечер'],
    [22, 'Добрый вечер'],
    [23, 'Доброй ночи'],
    [2, 'Доброй ночи'],
  ])('%i ч → %s', (h, want) => {
    expect(greetingForHour(h)).toBe(want);
  });
});
