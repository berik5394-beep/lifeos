import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveHabitDay } from './_habit-day.js';

describe('resolveHabitDay', () => {
  afterEach(() => vi.useRealTimers());
  it('вчера — с подписью; будущее и >30 дней — ошибка; без даты — сегодня', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T06:00:00Z'));
    expect(resolveHabitDay('Asia/Almaty', '2026-11-08')).toEqual({ day: new Date('2026-11-08T00:00:00Z'), label: ' за вчера' });
    expect(resolveHabitDay('Asia/Almaty').label).toBe('');
    expect(() => resolveHabitDay('Asia/Almaty', '2026-11-10')).toThrow(/наперёд/);
    expect(() => resolveHabitDay('Asia/Almaty', '2026-09-01')).toThrow(/30 дней/);
  });
});

import { deterministicIntent } from '../ai/intent-parser.js';
describe('быстрый путь: «сделал зарядку вчера»', () => {
  it('отметка за вчера, «вчера» не в имени', () => {
    const now = new Date('2026-11-09T06:00:00Z');
    expect(deterministicIntent('сделал зарядку вчера', 'Asia/Almaty', now)).toEqual({ action: 'complete_habit', habitName: 'зарядку', date: '2026-11-08' });
    expect(deterministicIntent('сделал зарядку', 'Asia/Almaty', now)).toEqual({ action: 'complete_habit', habitName: 'зарядку' });
  });
});
