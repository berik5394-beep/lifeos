import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/tools/create-task.ts'), 'utf-8');

describe('create_task — хук движка пересечения (день)', () => {
  it('фоновая оценка времени задачи', () => {
    expect(SRC).toContain('estimateTaskMinutesInBackground');
  });
  it('день задачи проверяет движок сдвига (старой строки про «сегодня» нет)', () => {
    expect(SRC).toContain('proposeReschedule(');
    expect(SRC).not.toContain('maybeDayLoadLine');
  });
  it('week-хук после дня (день в приоритете)', () => {
    expect(SRC).toContain('maybeWeekLoadLine');
    expect(SRC).toMatch(/reschedule \? null : await maybeWeekLoadLine/);
  });
  it('month-хук — третий уровень каскада (после дня и недели)', () => {
    expect(SRC).toContain('maybeMonthLoadLine');
    expect(SRC).toMatch(/reschedule \|\| weekLoad \? null : await maybeMonthLoadLine/);
    expect(SRC).toMatch(/reschedule\?\.text \?\? weekLoad \?\? monthLoad/);
  });
});
