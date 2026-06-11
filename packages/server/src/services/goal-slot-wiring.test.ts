import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('goal-slot — Part 1 proactive-insights', () => {
  const src = readFileSync(join(process.cwd(), 'src/services/proactive-insights.ts'), 'utf8');
  it('флаг-гейт + findUpcomingSlot + formatGoalSlotTail в goal_behind', () => {
    expect(src).toMatch(/isV2GoalSlotEnabled\(/);
    expect(src).toMatch(/findUpcomingSlot\(/);
    expect(src).toMatch(/formatGoalSlotTail\(/);
  });
  it('прежний литерал сообщения сохранён (off=identical)', () => {
    expect(src).toMatch(/Отстаём — давай наверстаем\?/);
  });
});
