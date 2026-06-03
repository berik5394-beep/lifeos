import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWeekLoad } from './week-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('describeWeekLoad', () => {
  it('overloaded → строка с «разнести по дням» + overflow + вопрос', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'почитать', demand: 90, importance: 1 },
      ],
    });
    const s = describeWeekLoad(fit)!;
    expect(s).toContain('На этой неделе');
    expect(s).toContain('почитать');
    expect(s).toContain('разнести по дням');
  });
  it('fits → null', () => {
    expect(describeWeekLoad(computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] }))).toBeNull();
  });
});

describe('week-load — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/week-load.ts'), 'utf-8');
  it('maybeWeekLoadLine: флаг + fit + дедуп против СВОИХ time:week_load', () => {
    expect(SRC).toContain('isV2WeekLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'week_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:week_load'");
  });
  it('gatherWeekLoad: задачи недели + sumWeekCapacity + границы недели (пн)', () => {
    expect(SRC).toContain('sumWeekCapacity');
    expect(SRC).toContain('localDayOfWeek');
    expect(SRC).toContain('estimatedMinutes ??');
  });
});
