import { describe, it, expect } from 'vitest';
import { safeDate, hhmm, materializeImport } from './import.js';

/**
 * A.5 — защитная валидация при материализации импорта. Аудит 3.12:
 * `new Date(garbage)` молча создаёт Invalid Date. Фиксируем регрессом
 * + что unknown/мусор не пытается писать в БД.
 */

describe('safeDate — только строгий YYYY-MM-DD', () => {
  it('валидная дата', () => {
    expect(safeDate('2026-05-17')?.toISOString().slice(0, 10)).toBe('2026-05-17');
  });
  it.each(['tomorrow', '17.05.2026', '2026-13-99', '', null, 42, '2026-5-1'])(
    'мусор «%s» → null (не Invalid Date)',
    (v) => expect(safeDate(v as unknown)).toBeNull(),
  );
});

describe('hhmm — только HH:MM', () => {
  it('валидное время', () => {
    expect(hhmm('09:30')).toBe('09:30');
    expect(hhmm('23:59')).toBe('23:59');
  });
  it.each(['25:00', '9:30', '0930', 'noon', null])(
    'мусор «%s» → null',
    (v) => expect(hhmm(v as unknown)).toBeNull(),
  );
});

describe('materializeImport — гейтинг без БД', () => {
  it('unknown purpose → ничего не создаёт (нулевой результат, без обращения к БД)', async () => {
    const r = await materializeImport('u1', 'unknown', [{ title: 'x', date: '2026-05-17' }]);
    expect(r).toEqual({ events: 0, tasks: 0, expenses: 0, habits: 0 });
  });
  it('нераспознанный purpose (не в whitelist) → нули, без БД', async () => {
    // SSOT P0 import: pdf-заглушка удалена (честный отказ в роуте до
    // парсинга). Гейт materializeImport остаётся защитой: любой
    // purpose вне meetings/tasks/expenses/habits ничего не пишет.
    const r = await materializeImport('u1', 'whatever', [{ note: 'x' }]);
    expect(r).toEqual({ events: 0, tasks: 0, expenses: 0, habits: 0 });
  });
});
