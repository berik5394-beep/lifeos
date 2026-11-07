import { describe, it, expect } from 'vitest';
import { formatJournalSection, formatWeekNotesSection, lowStreak, mondayOf, type JournalRow } from './reflection-context.js';
import { scoreSignificance } from './v2-proactivity-engine.js';

const row = (date: string, mood: number | null, energy: number | null = null, sleepHours: number | null = null, notes: string | null = null): JournalRow => ({ date, mood, energy, sleepHours, notes });

describe('дневник для мозга', () => {
  it('нет записей → null (ничего не выдумываем)', () => {
    expect(formatJournalSection([], '2026-11-07')).toBeNull();
    expect(formatJournalSection([row('2026-11-06', null)], '2026-11-07')).toBeNull();
  });
  it('средние сна/энергии/настроения + последняя запись', () => {
    const s = formatJournalSection(
      [row('2026-11-05', 8, 7, 7), row('2026-11-06', 6, 5, 6, 'устал после встречи')],
      '2026-11-07',
    );
    expect(s).toContain('сон в среднем 6.5 ч');
    expect(s).toContain('энергия 6/10');
    expect(s).toContain('настроение 7/10');
    expect(s).toContain('«устал после встречи»');
  });
  it('тренд: настроение падает последние дни', () => {
    const s = formatJournalSection(
      [row('2026-11-01', 9), row('2026-11-02', 8), row('2026-11-03', 9), row('2026-11-04', 6), row('2026-11-05', 5), row('2026-11-06', 6)],
      '2026-11-07',
    );
    expect(s).toContain('настроение падает');
  });
  it('3 дня подряд тяжело (настроение ИЛИ энергия ≤4), пропуск даты обрывает серию', () => {
    const rows = [row('2026-11-04', 2), row('2026-11-05', 8, 3), row('2026-11-06', 4), row('2026-11-07', 2)];
    expect(lowStreak(rows, '2026-11-07')).toBe(4);
    expect(lowStreak([row('2026-11-04', 2), row('2026-11-06', 2)], '2026-11-07')).toBe(1);
    // сегодня ещё не заполнил — считаем со вчера
    expect(lowStreak([row('2026-11-05', 3), row('2026-11-06', 3)], '2026-11-07')).toBe(2);
    expect(formatJournalSection(rows, '2026-11-07')).toContain('4 дн. подряд тяжело');
  });
});

describe('заметки недели для мозга', () => {
  const E = { notes: '', improve: '', gratitude: '', wins: '' };
  it('что получилось / улучшить / благодарность — своими словами юзера', () => {
    const s = formatWeekNotesSection({ ...E, wins: 'закрыл сделку', improve: 'ложиться до 23' }, null);
    expect(s).toBe('Заметки недели (сам записал): получилось — «закрыл сделку»; хочет улучшить — «ложиться до 23»');
  });
  it('на этой неделе пусто → напомнить, что собирался улучшить на прошлой', () => {
    expect(formatWeekNotesSection(E, { ...E, improve: 'спорт 3 раза' })).toBe('На прошлой неделе собирался улучшить: «спорт 3 раза»');
    expect(formatWeekNotesSection(null, null)).toBeNull();
  });
  it('понедельник недели', () => {
    expect(mondayOf('2026-11-07')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
  });
});

describe('нудж «тяжело по дневнику»', () => {
  it('3 дня — выше порога 0.6, дольше — значимее, но не выше 0.85', () => {
    const c = (days: number) => scoreSignificance({ source: 'journal_low', significance: 0, payload: { days }, toneHint: 'supportive' });
    expect(c(3)).toBeGreaterThanOrEqual(0.6);
    expect(c(5)).toBeGreaterThan(c(3));
    expect(c(30)).toBe(0.85);
  });
});
