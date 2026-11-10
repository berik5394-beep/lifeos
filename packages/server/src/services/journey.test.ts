import { describe, it, expect } from 'vitest';
import { bestStreak } from './journey.js';
import { memoryLine } from '../ai/jarvis-prompt.js';

describe('вехи и даты (G, 2026-11-10)', () => {
  it('лучшая серия и идёт ли сейчас', () => {
    expect(bestStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05'], '2026-11-10')).toEqual({ len: 3, ongoing: false });
    expect(bestStreak(['2026-11-07', '2026-11-08', '2026-11-09'], '2026-11-10')).toEqual({ len: 3, ongoing: true });
    expect(bestStreak([], '2026-11-10')).toEqual({ len: 0, ongoing: false });
  });
  it('воспоминание: когда записано и даты в тексте — относительно сегодня', () => {
    const now = new Date('2026-11-10T06:00:00Z');
    expect(memoryLine({ content: 'Переживает за проект', createdAt: new Date('2026-10-20T08:00:00Z') }, 'Asia/Almaty', now)).toBe(
      'Переживает за проект [записано 20 октября (3 нед. назад)]',
    );
    expect(memoryLine({ content: 'Собеседование 11 ноября', createdAt: now }, 'Asia/Almaty', now)).toBe('Собеседование 11 ноября (завтра)');
  });
});
