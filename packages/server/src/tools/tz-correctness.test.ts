import { describe, it, expect } from 'vitest';
import { localDateStr } from '../lib/tz.js';
import { weekdayRu } from './get-today.js';

/**
 * SSOT invariant — tz-correctness (фикс бага #3).
 * Asia/Almaty = UTC+5, без DST. Проверяем границу суток: когда
 * UTC уже «следующий день», а Алматы ещё нет (и наоборот), дата и
 * день недели берутся в зоне юзера, не в UTC. Прямой регресс-тест
 * на «20 мая — вторник»-галлюцинацию.
 */

const ALM = 'Asia/Almaty';

describe('Almaty 23:00 — всё ещё сегодняшний день', () => {
  it('2026-05-17 23:00 Almaty (=18:00Z) → дата 2026-05-17, воскресенье', () => {
    const at = new Date('2026-05-17T18:00:00Z'); // 23:00 Almaty
    expect(localDateStr(ALM, at)).toBe('2026-05-17');
    expect(weekdayRu(ALM, at)).toBe('воскресенье');
  });
});

describe('граница суток: UTC уже завтра, Алматы ещё нет — и наоборот', () => {
  it('2026-05-17T20:00Z = Алматы уже 2026-05-18 (понедельник), не 17/вс', () => {
    const at = new Date('2026-05-17T20:00:00Z'); // 01:00 Almaty 18-го
    expect(localDateStr(ALM, at)).toBe('2026-05-18');
    expect(weekdayRu(ALM, at)).toBe('понедельник');
    // UTC-наивный код вернул бы 2026-05-17/воскресенье — это и был баг
    expect(localDateStr('UTC', at)).toBe('2026-05-17');
  });

  it('2026-05-17T02:00Z = Алматы ещё 07:00 того же дня (17/вс)', () => {
    const at = new Date('2026-05-17T02:00:00Z');
    expect(localDateStr(ALM, at)).toBe('2026-05-17');
    expect(weekdayRu(ALM, at)).toBe('воскресенье');
  });
});

describe('регресс бага #3: «20 мая» — это среда, не вторник', () => {
  it('2026-05-20 в Алматы → среда', () => {
    const at = new Date('2026-05-20T06:00:00Z'); // 11:00 Almaty 20-го
    expect(localDateStr(ALM, at)).toBe('2026-05-20');
    expect(weekdayRu(ALM, at)).toBe('среда');
  });

  it.each([
    ['2026-05-17', 'воскресенье'],
    ['2026-05-18', 'понедельник'],
    ['2026-05-19', 'вторник'],
    ['2026-05-20', 'среда'],
    ['2026-05-21', 'четверг'],
  ])('%s → %s', (date, wd) => {
    const at = new Date(`${date}T08:00:00Z`); // 13:00 Almaty
    expect(localDateStr(ALM, at)).toBe(date);
    expect(weekdayRu(ALM, at)).toBe(wd);
  });
});
