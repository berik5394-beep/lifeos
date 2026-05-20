import { describe, it, expect } from 'vitest';
import {
  burnoutDetector,
  sleepDisruptionDetector,
  conflictFollowupDetector,
  missedImportantDateDetector,
  intentionDeviationDetector,
} from './therapeutic-detectors.js';

const NOW = new Date('2026-05-20T10:00:00Z');

describe('burnoutDetector — 5+ встреч 3 дня подряд', () => {
  it('5/5/5 → срабатывает sev7, источник reflector', () => {
    const c = burnoutDetector({ meetingsPerDay: [3, 4, 5, 5, 5] });
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('therapeutic_burnout');
    expect(c!.severity).toBe(7);
    expect(c!.source).toBe('reflector');
  });
  it('2 дня высоких + 1 спокойный → молчит (нет streak)', () => {
    expect(burnoutDetector({ meetingsPerDay: [5, 5, 2] })).toBeNull();
  });
  it('меньше N дней данных → молчит', () => {
    expect(burnoutDetector({ meetingsPerDay: [5, 5] })).toBeNull();
  });
});

describe('sleepDisruptionDetector — <70% от базовой', () => {
  it('базовая ~7.5ч, последние 4ч → срабатывает', () => {
    const c = sleepDisruptionDetector({
      hoursLast14d: [7, 8, 7.5, 7, 8, 7, 7.5, 8, 7, 7.5, 4, 4.5, 4],
    });
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('therapeutic_sleep_drop');
  });
  it('равномерно — молчит (нет drop)', () => {
    expect(
      sleepDisruptionDetector({
        hoursLast14d: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
      }),
    ).toBeNull();
  });
  it('мало baseline-данных → молчит (честно, не догадка)', () => {
    expect(
      sleepDisruptionDetector({ hoursLast14d: [7, 4, 4] }),
    ).toBeNull();
  });
});

describe('conflictFollowupDetector — 24-48ч после упоминания', () => {
  const mention = (hoursAgo: number) => ({
    snippet: 'поссорился с Сериком',
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  });
  it('упоминание ~30ч назад, не было follow-up → срабатывает', () => {
    const c = conflictFollowupDetector({
      mentions: [mention(30)],
      lastFollowupAt: null,
      now: NOW,
    });
    expect(c).not.toBeNull();
    expect(c!.message).toContain('Серик');
  });
  it('упоминание 12ч назад → рано', () => {
    expect(
      conflictFollowupDetector({
        mentions: [mention(12)],
        lastFollowupAt: null,
        now: NOW,
      }),
    ).toBeNull();
  });
  it('72ч назад → поздно (окно прошло)', () => {
    expect(
      conflictFollowupDetector({
        mentions: [mention(72)],
        lastFollowupAt: null,
        now: NOW,
      }),
    ).toBeNull();
  });
  it('follow-up был 3 дня назад → тишина (уважение к «не хочу»)', () => {
    expect(
      conflictFollowupDetector({
        mentions: [mention(30)],
        lastFollowupAt: new Date(NOW.getTime() - 3 * 86_400_000),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe('missedImportantDateDetector — день в день', () => {
  it('сегодня день рождения мамы → срабатывает', () => {
    const c = missedImportantDateDetector({
      dates: [{ what: 'день рождения мамы', date: new Date('2024-05-20') }],
      todayLocal: '2026-05-20',
    });
    expect(c).not.toBeNull();
    expect(c!.message).toContain('день рождения мамы');
  });
  it('сегодня не та дата → молчит', () => {
    expect(
      missedImportantDateDetector({
        dates: [{ what: 'др папы', date: new Date('2024-03-15') }],
        todayLocal: '2026-05-20',
      }),
    ).toBeNull();
  });
});

describe('intentionDeviationDetector — намерение vs факт', () => {
  it('«меньше тратить на еду», +30% — срабатывает', () => {
    const c = intentionDeviationDetector({
      stated: 'меньше тратить на еду',
      lastWeekValue: 30000,
      thisWeekValue: 40000,
      direction: 'less',
    });
    expect(c).not.toBeNull();
    expect(c!.message).toContain('меньше тратить на еду');
  });
  it('изменение в нужную сторону — молчит', () => {
    expect(
      intentionDeviationDetector({
        stated: 'меньше тратить',
        lastWeekValue: 30000,
        thisWeekValue: 22000,
        direction: 'less',
      }),
    ).toBeNull();
  });
  it('lastWeek=0 → молчит (нет базы, не выдумываем)', () => {
    expect(
      intentionDeviationDetector({
        stated: 'x',
        lastWeekValue: 0,
        thisWeekValue: 100,
        direction: 'less',
      }),
    ).toBeNull();
  });
});
