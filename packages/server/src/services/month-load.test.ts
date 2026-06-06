import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMonthLoad } from './month-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('describeMonthLoad', () => {
  it('overloaded → строка «следующий месяц» + overflow + вопрос', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'прочитать книгу', demand: 120, importance: 1 },
      ],
    });
    const s = describeMonthLoad(fit)!;
    expect(s).toContain('В этом месяце');
    expect(s).toContain('прочитать книгу');
    expect(s).toContain('следующий месяц');
  });
  it('fits → null', () => {
    expect(describeMonthLoad(computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] }))).toBeNull();
  });
});

describe('month-load — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/month-load.ts'), 'utf-8');
  it('maybeMonthLoadLine: флаг + fit + дедуп против СВОИХ time:month_load', () => {
    expect(SRC).toContain('isV2MonthLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'month_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:month_load'");
  });
  it('gatherMonthLoad: задачи + недельные цели + sumWeekCapacity + границы месяца', () => {
    expect(SRC).toContain('localMonthOnlyUTC');
    expect(SRC).toContain('sumWeekCapacity');
    expect(SRC).toContain('weeklyGoal.findMany');
    expect(SRC).toContain('DEFAULT_GOAL_MINUTES');
    expect(SRC).toContain('estimatedMinutes ??');
  });
});
