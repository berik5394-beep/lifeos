import { goalPercent } from '@/utils/goal-progress';

describe('прогресс цели — проценты, как на сервере', () => {
  it('проценты как есть, старые доли — ×100, предел 100', () => {
    expect(goalPercent(50)).toBe(50); // голосом «прочитал 25 из 50 книг» — 50%, а не 5000%
    expect(goalPercent(0.3)).toBe(30); // старая запись-доля
    expect(goalPercent(150)).toBe(100);
    expect(goalPercent(null)).toBe(0);
  });
});

describe('аудит 2026-11-09: 1% — это 1%', () => {
  it('целое 1 → 1%, а не «выполнено»', () => {
    expect(goalPercent(1)).toBe(1);
    expect(goalPercent(0.5)).toBe(50);
  });
});

import { effectiveGoalPercent } from '@/utils/goal-progress';
describe('кольцо цели — живой прогресс денежной цели', () => {
  it('liveProgress важнее сохранённого', () => {
    expect(effectiveGoalPercent({ progress: 0, liveProgress: 40 })).toBe(40);
    expect(effectiveGoalPercent({ progress: 30 })).toBe(30);
    expect(effectiveGoalPercent({ progress: 0, liveProgress: 140 })).toBe(100);
  });
});
