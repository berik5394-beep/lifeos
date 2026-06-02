import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeDayLoad, mapPriority } from './day-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('mapPriority', () => {
  it('high/critical→3, medium→2, low→1', () => {
    expect(mapPriority('critical')).toBe(3);
    expect(mapPriority('high')).toBe(3);
    expect(mapPriority('medium')).toBe(2);
    expect(mapPriority('low')).toBe(1);
  });
});

describe('describeDayLoad', () => {
  it('overloaded → строка с переносом + вопросом', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'почитать', demand: 90, importance: 1 },
      ],
    });
    const s = describeDayLoad(fit)!;
    expect(s).toContain('не всё влезет');
    expect(s).toContain('почитать'); // overflow → перенести
    expect(s).toContain('хватит ли времени');
  });
  it('fits → null (молчим)', () => {
    const fit = computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] });
    expect(describeDayLoad(fit)).toBeNull();
  });
});

describe('day-load — проводка хука (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/day-load.ts'), 'utf-8');
  it('maybeDayLoadLine: флаг + gather + fit + дедуп против СВОИХ', () => {
    expect(SRC).toContain('isV2DayLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'day_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:day_load'");
  });
  it('gatherDayLoad: estimatedMinutes ?? дефолт + availableMinutesToday', () => {
    expect(SRC).toContain('estimatedMinutes ??');
    expect(SRC).toContain('availableMinutesToday');
  });
});
