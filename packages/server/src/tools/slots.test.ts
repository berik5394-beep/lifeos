import { describe, it, expect } from 'vitest';
import { findFreeSlots, timeDiff } from './_slots.js';

/** SSOT Step 3b — поведение поиска окон 1:1 с legacy (без дрейфа). */

describe('timeDiff', () => {
  it('минуты между HH:MM', () => {
    expect(timeDiff('09:00', '10:30')).toBe(90);
    expect(timeDiff('09:00', '09:00')).toBe(0);
  });
});

describe('findFreeSlots', () => {
  const day = (s: string) => new Date(s + 'T00:00:00Z');

  it('пустой день → одно окно 09:00–20:00', () => {
    const slots = findFreeSlots([], day('2026-05-18'), day('2026-05-18'), 60);
    expect(slots).toEqual([
      { date: '2026-05-18', from: '09:00', to: '20:00', durationMinutes: 660 },
    ]);
  });

  it('встреча в середине дня → два окна вокруг неё', () => {
    const events = [
      { date: day('2026-05-18'), startTime: '13:00', endTime: '14:00' },
    ];
    const slots = findFreeSlots(events, day('2026-05-18'), day('2026-05-18'), 60);
    expect(slots).toEqual([
      { date: '2026-05-18', from: '09:00', to: '13:00', durationMinutes: 240 },
      { date: '2026-05-18', from: '14:00', to: '20:00', durationMinutes: 360 },
    ]);
  });

  it('окно короче minDuration отбрасывается', () => {
    const events = [
      { date: day('2026-05-18'), startTime: '09:30', endTime: '19:30' },
    ];
    const slots = findFreeSlots(events, day('2026-05-18'), day('2026-05-18'), 60);
    expect(slots).toEqual([]); // 09:00–09:30 (30м) и 19:30–20:00 (30м) < 60
  });
});
