import { MOOD_LEVELS, moodEmoji, moodLevel } from '@/constants/mood';

describe('одна шкала настроения 1–10', () => {
  it('смайлик пишет значение 1–10, и это же значение его подсвечивает', () => {
    MOOD_LEVELS.forEach((l, i) => expect(moodLevel(l.value)).toBe(i));
  });
  it('голосом «настроение 7» и старые значения попадают в свой смайлик', () => {
    expect(moodLevel(1)).toBe(0);
    expect(moodLevel(7)).toBe(3);
    expect(moodLevel(10)).toBe(4);
    expect(moodEmoji(null)).toBe('—');
  });
});
