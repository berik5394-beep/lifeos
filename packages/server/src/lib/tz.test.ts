import { describe, it, expect } from 'vitest';
import { localDateStr, localDayStartUTC, localDayStartUTCOffset } from './tz.js';

/**
 * B.5 фундамент. Ключевой кейс аудита 2.7: 2026-05-16T19:30Z —
 * сервер (UTC) думает 16-е, а в Алматы (UTC+5) уже 17-е 00:30.
 */
const lateNightAlmaty = new Date('2026-05-16T19:30:00Z');

describe('localDateStr', () => {
  it('Алматы (UTC+5): поздний вечер UTC = уже следующий день локально', () => {
    expect(localDateStr('Asia/Almaty', lateNightAlmaty)).toBe('2026-05-17');
  });
  it('UTC: тот же инстант = ещё 16-е', () => {
    expect(localDateStr('UTC', lateNightAlmaty)).toBe('2026-05-16');
  });
  it('мусорная зона → фолбэк UTC, не бросает', () => {
    expect(localDateStr('Mars/Olympus', lateNightAlmaty)).toBe('2026-05-16');
  });
});

describe('localDayStartUTC', () => {
  it('полночь Алматы 17-го = 2026-05-16T19:00:00Z', () => {
    expect(localDayStartUTC('Asia/Almaty', lateNightAlmaty).toISOString()).toBe(
      '2026-05-16T19:00:00.000Z',
    );
  });
  it('полночь UTC 16-го = 2026-05-16T00:00:00Z', () => {
    expect(localDayStartUTC('UTC', lateNightAlmaty).toISOString()).toBe(
      '2026-05-16T00:00:00.000Z',
    );
  });
});

describe('localDayStartUTCOffset', () => {
  it('вчера в Алматы относительно позднего вечера = старт 16-го локально', () => {
    // локальный день — 17-е; вчера = 16-е; старт = 2026-05-15T19:00Z
    expect(
      localDayStartUTCOffset('Asia/Almaty', 1, lateNightAlmaty).toISOString(),
    ).toBe('2026-05-15T19:00:00.000Z');
  });
  it('0 дней = сегодняшняя локальная полночь', () => {
    expect(
      localDayStartUTCOffset('Asia/Almaty', 0, lateNightAlmaty).toISOString(),
    ).toBe('2026-05-16T19:00:00.000Z');
  });
});
