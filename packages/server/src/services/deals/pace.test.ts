import { describe, it, expect } from 'vitest';
import { salesPace, coveringDeals } from './pace.js';

describe('темп плана продаж', () => {
  it('до 7-го дня не «отстаёшь»', () => {
    expect(salesPace({ plan: 10_000_000, won: 0, open: 0, dayOfMonth: 6, daysInMonth: 30 }).behind).toBe(false);
  });
  it('15-го из 30, закрыто 2 из 10 млн → отстаёшь (ожидалось 5, порог 4)', () => {
    const p = salesPace({ plan: 10_000_000, won: 2_000_000, open: 9_000_000, dayOfMonth: 15, daysInMonth: 30 });
    expect(p.behind).toBe(true);
    expect(p.gap).toBe(8_000_000);
    expect(p.coverable).toBe(true);
  });
  it('закрыто 4.5 из 10 на 15-й день → не отстаёшь (≥ 80% ожидаемого)', () => {
    expect(salesPace({ plan: 10_000_000, won: 4_500_000, open: 0, dayOfMonth: 15, daysInMonth: 30 }).behind).toBe(false);
  });
  it('в работе не хватает на разрыв → coverable=false', () => {
    expect(salesPace({ plan: 10_000_000, won: 1_000_000, open: 3_000_000, dayOfMonth: 20, daysInMonth: 30 }).coverable).toBe(false);
  });
  it('план выполнен → разрыв 0', () => {
    expect(salesPace({ plan: 5, won: 7, open: 0, dayOfMonth: 20, daysInMonth: 30 }).gap).toBe(0);
  });
  it('coveringDeals: крупнейшие открытые, пока не закроют разрыв', () => {
    const deals = [
      { personName: 'Серик', amount: 3_000_000 },
      { personName: 'Ахмет', amount: 5_000_000 },
      { personName: 'Дана', amount: 1_000_000 },
      { personName: 'Без суммы', amount: null },
    ];
    expect(coveringDeals(deals, 6_000_000).map((d) => d.personName)).toEqual(['Ахмет', 'Серик']);
    expect(coveringDeals(deals, 20_000_000)).toEqual([]); // не покрыть — никого не называем
  });
});
