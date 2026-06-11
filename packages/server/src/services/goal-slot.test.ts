import { describe, it, expect } from 'vitest';
import { ruDayName, formatGoalSlotTail } from './goal-slot.js';

describe('ruDayName', () => {
  it('известные даты', () => {
    expect(ruDayName('2026-06-11')).toBe('четверг');
    expect(ruDayName('2026-06-12')).toBe('пятницу');
    expect(ruDayName('2026-06-14')).toBe('воскресенье');
  });
});

describe('formatGoalSlotTail', () => {
  it('день+дата+время+CTA', () => {
    const s = formatGoalSlotTail({ date: '2026-06-11', from: '18:00', to: '20:00', durationMinutes: 120 });
    expect(s).toContain('четверг');
    expect(s).toContain('11.06');
    expect(s).toContain('18:00');
    expect(s).toContain('Скажи «да»');
  });

  it('durationMinutes > 120 капится до ~120', () => {
    const s = formatGoalSlotTail({ date: '2026-06-12', from: '09:00', to: '20:00', durationMinutes: 660 });
    expect(s).toContain('~120 мин');
  });
});
