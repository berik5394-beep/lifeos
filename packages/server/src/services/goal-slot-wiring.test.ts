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

describe('goal-slot — Part 2 reply-context', () => {
  const store = readFileSync(join(process.cwd(), 'src/services/insight-store.ts'), 'utf8');
  it('за флагом пишет доставленный нудж в ChatMessage как assistant', () => {
    expect(store).toMatch(/isV2GoalSlotEnabled\(/);
    expect(store).toMatch(/chatMessage[\s\S]{0,40}\.create\(/);
    expect(store).toMatch(/role:\s*'assistant'/);
  });
});
