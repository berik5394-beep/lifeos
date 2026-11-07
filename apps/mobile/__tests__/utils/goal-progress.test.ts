import { goalPercent } from '@/utils/goal-progress';

describe('прогресс цели — проценты, как на сервере', () => {
  it('проценты как есть, старые доли — ×100, предел 100', () => {
    expect(goalPercent(50)).toBe(50); // голосом «прочитал 25 из 50 книг» — 50%, а не 5000%
    expect(goalPercent(0.3)).toBe(30); // старая запись-доля
    expect(goalPercent(150)).toBe(100);
    expect(goalPercent(null)).toBe(0);
  });
});
