import { describe, it, expect } from 'vitest';
import { shiftTimes, googleNote, matchEventTitles } from './event-change.js';
import { googlePatchBody } from './google-calendar.js';

describe('перенос встречи — время', () => {
  const old = { startTime: '14:00', endTime: '15:30' };
  it('только новое начало → длительность сохраняется', () => {
    expect(shiftTimes(old, { startTime: '16:00' })).toEqual({ startTime: '16:00', endTime: '17:30' });
  });
  it('дали и конец → как дали; ничего не дали → прежнее', () => {
    expect(shiftTimes(old, { startTime: '16:00', endTime: '16:30' })).toEqual({ startTime: '16:00', endTime: '16:30' });
    expect(shiftTimes(old, {})).toEqual(old);
  });
  it('не перелезаем за полночь; без прежнего конца — конца нет', () => {
    expect(shiftTimes(old, { startTime: '23:00' })).toEqual({ startTime: '23:00', endTime: '23:59' });
    expect(shiftTimes({ startTime: '10:00', endTime: null }, { startTime: '12:00' })).toEqual({ startTime: '12:00', endTime: null });
  });
});

describe('честность про Google', () => {
  it('не ушло в Google → предупреждаем; не из Google / ушло → молчим', () => {
    expect(googleNote('failed', 'patch')).toContain('синхронизация вернёт старое время');
    expect(googleNote('failed', 'delete')).toContain('синхронизация вернёт её');
    expect(googleNote('ok', 'patch')).toBe('');
    expect(googleNote('none', 'delete')).toBe('');
  });
});

describe('строгий матч названия встречи (ревью: удалили бы не ту)', () => {
  it('имя должно совпасть: «Ахмет» ≠ «Серик», «Асет», «команда»', () => {
    expect(matchEventTitles('встреча с Ахметом', ['Встреча с Сериком'])).toEqual([]);
    expect(matchEventTitles('встречу с Ахметом', ['Встреча с Сериком', 'Обед'])).toEqual([]);
    expect(matchEventTitles('встреча с Ахметом', ['Встреча с Асетом'])).toEqual([]);
    expect(matchEventTitles('созвон с Айдаром', ['Созвон с командой'])).toEqual([]);
  });
  it('находит по имени в любой форме; повторяющиеся названия — одно', () => {
    expect(matchEventTitles('встречу с Ахметом', ['Встреча с Ахметом', 'Встреча с Ахметом', 'Обед'])).toEqual(['Встреча с Ахметом']);
    expect(matchEventTitles('Ахмет', ['Встреча с Ахметом', 'Встреча с Ахметом'])).toEqual(['Встреча с Ахметом']);
    expect(matchEventTitles('планерку', ['Планёрка отдела', 'Планёрка отдела'])).toEqual(['Планёрка отдела']);
  });
  it('два разных подходящих → оба (переспросить); только «встреча» — лишь точное', () => {
    expect(matchEventTitles('Ахмет', ['Встреча с Ахметом', 'Обед с Ахметом'])).toEqual(['Встреча с Ахметом', 'Обед с Ахметом']);
    expect(matchEventTitles('встречу', ['Встреча с Ахметом'])).toEqual([]);
    expect(matchEventTitles('встреча', ['Встреча'])).toEqual(['Встреча']);
  });
});

describe('PATCH в Google: весь день ⇄ со временем', () => {
  const base = { title: 'X', date: '2026-11-13', location: null, description: null };
  it('стало со временем — start.date обнулён', () => {
    const b = googlePatchBody({ ...base, startTime: '10:00', endTime: '11:00' }) as { start: Record<string, unknown> };
    expect(b.start).toMatchObject({ dateTime: '2026-11-13T10:00:00', date: null });
  });
  it('стало на весь день — dateTime/timeZone обнулены', () => {
    const b = googlePatchBody({ ...base, startTime: null, endTime: null }) as { start: Record<string, unknown> };
    expect(b.start).toEqual({ date: '2026-11-13', dateTime: null, timeZone: null });
  });
});
