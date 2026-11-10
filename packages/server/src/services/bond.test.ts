import { describe, it, expect } from 'vitest';
import { daysTogether, daysWord, formatBondSection } from './bond.js';

/** «Наша связь» (2026-11-10): друг помнит историю, незакрытое и делится своим. */
describe('bond — чистые части', () => {
  it('склонение дней', () => {
    expect(daysWord(1)).toBe('1 день');
    expect(daysWord(22)).toBe('22 дня');
    expect(daysWord(11)).toBe('11 дней');
    expect(daysWord(47)).toBe('47 дней');
    expect(daysWord(101)).toBe('101 день');
  });
  it('сколько знакомы по календарю', () => {
    expect(daysTogether(new Date('2026-09-24T00:00:00Z'), new Date('2026-11-10T00:00:00Z'))).toBe(47);
    expect(daysTogether(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-10T00:00:00Z'))).toBe(0);
  });
  it('блок: история, круглая дата, незакрытое, дневник — только что есть', () => {
    const full = formatBondSection({
      days: 30,
      since: new Date('2026-10-11T00:00:00Z'),
      milestone: 30,
      thread: 'Завтра собеседование в Kaspi, очень волнуюсь',
      diary: 'Сегодня Алия закрыла презентацию — мне запомнилось, как она радовалась.',
    });
    expect(full).toContain('вы знакомы 30 дней (с 11 октября)');
    expect(full).toContain('Сегодня ровно 30 дней знакомства');
    expect(full).toContain('«Завтра собеседование в Kaspi, очень волнуюсь»');
    expect(full).toContain('Твоя запись в дневнике');
    const bare = formatBondSection({ days: 3, since: new Date('2026-11-07T00:00:00Z'), milestone: null, thread: null, diary: null });
    expect(bare).toBe('Наша история: вы знакомы 3 дня (с 7 ноября).');
    expect(formatBondSection({ days: 0, since: new Date(), milestone: null, thread: null, diary: null })).toMatch(/первый разговор/);
  });
});
