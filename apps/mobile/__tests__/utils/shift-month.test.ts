import { shiftMonth } from '@/utils/dates';

/** Аудит 2026-11-09: листание месяца 29–31 числа не перескакивает. */
describe('shiftMonth', () => {
  it('31 октября «‹» → сентябрь, 31 января «›» → февраль', () => {
    expect(shiftMonth(new Date(2026, 9, 31), -1).getMonth()).toBe(8);
    const feb = shiftMonth(new Date(2027, 0, 31), 1);
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 28]);
    expect(shiftMonth(new Date(2026, 11, 15), 1).getFullYear()).toBe(2027);
  });
});
