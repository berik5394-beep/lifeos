import { describe, it, expect } from 'vitest';
import { localDateOnlyUTC, dateOnlyUTC, localDayStartUTC } from './tz.js';

describe('localDateOnlyUTC — @db.Date значение = UTC-полночь календарной даты', () => {
  it('Almaty 09:16: даёт UTC-полночь СЕГОДНЯ (не civil−1)', () => {
    const at = new Date('2026-06-06T04:16:00Z'); // 09:16 Almaty
    const d = localDateOnlyUTC('Asia/Almaty', at);
    expect(d.toISOString()).toBe('2026-06-06T00:00:00.000Z');
    // localDayStartUTC (старое) дало бы предыдущий день — фиксируем разницу:
    expect(localDayStartUTC('Asia/Almaty', at).toISOString()).toBe('2026-06-05T19:00:00.000Z');
  });

  it('Almaty 00:30 след. суток: даёт UTC-полночь нового дня', () => {
    const at = new Date('2026-06-06T19:30:00Z'); // 00:30 Almaty 07 июня
    expect(localDateOnlyUTC('Asia/Almaty', at).toISOString()).toBe('2026-06-07T00:00:00.000Z');
  });

  it('UTC юзер: совпадает с обычной полуночью', () => {
    const at = new Date('2026-06-06T10:00:00Z');
    expect(localDateOnlyUTC('UTC', at).toISOString()).toBe('2026-06-06T00:00:00.000Z');
  });

  it('dateOnlyUTC из строки', () => {
    expect(dateOnlyUTC('2026-06-06').toISOString()).toBe('2026-06-06T00:00:00.000Z');
  });

  it('мусорная tz → фолбэк UTC, не бросает', () => {
    const at = new Date('2026-06-06T10:00:00Z');
    expect(localDateOnlyUTC('Bad/Zone', at).toISOString()).toBe('2026-06-06T00:00:00.000Z');
  });
});
