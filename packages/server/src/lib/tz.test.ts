import { describe, it, expect } from 'vitest';
import {
  localDateStr,
  localDayStartUTC,
  localMonthStartUTC,
  localDayStartUTCOffset,
  localTimeStr,
  isInQuietHours,
} from './tz.js';

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

// ---------------------------------------------------------------------------
// Phase 7 P1 — DND quiet hours.
// ---------------------------------------------------------------------------

describe('localTimeStr', () => {
  const at = new Date('2026-05-25T14:30:00Z'); // 14:30 UTC
  it('UTC: 14:30', () => {
    expect(localTimeStr('UTC', at)).toBe('14:30');
  });
  it('Asia/Almaty (UTC+5): 19:30', () => {
    expect(localTimeStr('Asia/Almaty', at)).toBe('19:30');
  });
  it('zero-padded формат всегда HH:MM (5 chars)', () => {
    const midnight = new Date('2026-05-25T00:05:00Z');
    expect(localTimeStr('UTC', midnight)).toBe('00:05');
    expect(localTimeStr('UTC', midnight)).toHaveLength(5);
  });
});

describe('isInQuietHours — DND friend respects time', () => {
  // Использую UTC для контроля. Asia/Almaty smoke в отдельном it.
  const at1300 = new Date('2026-05-25T13:00:00Z');
  const at1500 = new Date('2026-05-25T15:00:00Z');
  const at1700 = new Date('2026-05-25T17:00:00Z');
  const at0200 = new Date('2026-05-25T02:00:00Z');
  const at2330 = new Date('2026-05-25T23:30:00Z');
  const at0800 = new Date('2026-05-25T08:00:00Z');

  describe('null/undefined — DND off', () => {
    it('обе null → false', () => {
      expect(isInQuietHours(null, null, 'UTC', at0200)).toBe(false);
    });
    it('start null → false', () => {
      expect(isInQuietHours(null, '08:00', 'UTC', at0200)).toBe(false);
    });
    it('end null → false', () => {
      expect(isInQuietHours('23:00', null, 'UTC', at0200)).toBe(false);
    });
    it('undefined → false', () => {
      expect(isInQuietHours(undefined, undefined, 'UTC', at0200)).toBe(false);
    });
  });

  describe('линейный интервал (start < end)', () => {
    it('13:00→17:00, сейчас 15:00 → true', () => {
      expect(isInQuietHours('13:00', '17:00', 'UTC', at1500)).toBe(true);
    });
    it('13:00→17:00, сейчас 13:00 (точно start) → true (inclusive)', () => {
      expect(isInQuietHours('13:00', '17:00', 'UTC', at1300)).toBe(true);
    });
    it('13:00→17:00, сейчас 17:00 (точно end) → false (exclusive)', () => {
      expect(isInQuietHours('13:00', '17:00', 'UTC', at1700)).toBe(false);
    });
    it('13:00→17:00, сейчас 02:00 → false', () => {
      expect(isInQuietHours('13:00', '17:00', 'UTC', at0200)).toBe(false);
    });
  });

  describe('cross-midnight (start > end) — DND ночной', () => {
    it('23:00→08:00, сейчас 02:00 → true (внутри)', () => {
      expect(isInQuietHours('23:00', '08:00', 'UTC', at0200)).toBe(true);
    });
    it('23:00→08:00, сейчас 23:30 → true (внутри)', () => {
      expect(isInQuietHours('23:00', '08:00', 'UTC', at2330)).toBe(true);
    });
    it('23:00→08:00, сейчас 08:00 (точно end) → false (exclusive)', () => {
      expect(isInQuietHours('23:00', '08:00', 'UTC', at0800)).toBe(false);
    });
    it('23:00→08:00, сейчас 15:00 → false (вне)', () => {
      expect(isInQuietHours('23:00', '08:00', 'UTC', at1500)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('start == end → false (нулевой интервал)', () => {
      expect(isInQuietHours('13:00', '13:00', 'UTC', at1300)).toBe(false);
    });
    it('невалидный формат → false (graceful, не падает)', () => {
      expect(isInQuietHours('bad', '08:00', 'UTC', at0200)).toBe(false);
      expect(isInQuietHours('23:00', 'bad', 'UTC', at0200)).toBe(false);
      expect(isInQuietHours('25:99', '08:00', 'UTC', at0200)).toBe(false);
    });
  });

  describe('таймзона юзера учитывается', () => {
    // 23:00 UTC = 04:00 Asia/Almaty (UTC+5). DND 23:00→08:00 Almaty:
    //   сейчас 04:00 Almaty → ВНУТРИ → true.
    const at2300UTC = new Date('2026-05-25T23:00:00Z');
    it('DND 23:00→08:00 в Asia/Almaty, при UTC 23:00 (=04:00 Almaty) → true', () => {
      expect(isInQuietHours('23:00', '08:00', 'Asia/Almaty', at2300UTC)).toBe(
        true,
      );
    });
    // Тот же момент в UTC: 23:00. DND 23:00→08:00 UTC → start inclusive → true.
    it('тот же UTC-инстант в UTC tz → тоже true (23:00 == start)', () => {
      expect(isInQuietHours('23:00', '08:00', 'UTC', at2300UTC)).toBe(true);
    });
  });
});

describe('localMonthStartUTC — начало локального месяца как UTC', () => {
  it('середина месяца (Алматы UTC+5) → 1-е 00:00 локально = пред. день 19:00 UTC', () => {
    const r = localMonthStartUTC('Asia/Almaty', new Date('2026-05-16T19:30:00Z'));
    expect(r.toISOString()).toBe('2026-04-30T19:00:00.000Z');
  });
  it('переход года: декабрь → 1 декабря', () => {
    const r = localMonthStartUTC('Asia/Almaty', new Date('2026-12-20T10:00:00Z'));
    expect(r.toISOString()).toBe('2026-11-30T19:00:00.000Z');
  });
  it('невалидная tz → не падает (фолбэк UTC, 1-е 00:00 UTC)', () => {
    const r = localMonthStartUTC('Garbage/Zone', new Date('2026-05-16T10:00:00Z'));
    expect(r.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
