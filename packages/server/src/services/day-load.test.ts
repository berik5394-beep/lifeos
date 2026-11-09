import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapPriority } from './day-load.js';

describe('mapPriority', () => {
  it('high/critical→3, medium→2, low→1', () => {
    expect(mapPriority('critical')).toBe(3);
    expect(mapPriority('high')).toBe(3);
    expect(mapPriority('medium')).toBe(2);
    expect(mapPriority('low')).toBe(1);
  });
});

describe('day-load — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/day-load.ts'), 'utf-8');
  it('без флага; старой строки «сегодня перегружен» (maybeDayLoadLine) нет — день считает движок сдвига', () => {
    expect(SRC).not.toContain('isV2DayLoadEnabled');
    expect(SRC).not.toContain('maybeDayLoadLine');
  });
  it('gatherDayLoad: estimatedMinutes ?? дефолт + availableMinutesToday', () => {
    expect(SRC).toContain('estimatedMinutes ??');
    expect(SRC).toContain('availableMinutesToday');
  });
});
