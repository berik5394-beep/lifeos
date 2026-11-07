import { parseAmountNote } from '@/utils/amount';

describe('сумма с пометкой', () => {
  it.each([
    ['5000 обед', { amount: 5000, note: 'обед' }],
    ['5 000', { amount: 5000, note: '' }],
    ['5к такси', { amount: 5000, note: 'такси' }],
    ['1,5к', { amount: 1500, note: '' }],
    ['12 500 ₸ кофе', { amount: 12500, note: 'кофе' }],
  ])('«%s»', (raw, want) => expect(parseAmountNote(raw)).toEqual(want));
  it.each(['обед', '', '0', '-5'])('«%s» → не сумма', (raw) => expect(parseAmountNote(raw)).toBeNull());
});

import { parseCategoryEntry, entryDateForMonth } from '@/utils/amount';

describe('строка категории трат', () => {
  it('сумма — трата, «лимит N» — лимит', () => {
    expect(parseCategoryEntry('5000 обед')).toEqual({ kind: 'expense', amount: 5000, note: 'обед' });
    expect(parseCategoryEntry('лимит 50 000')).toEqual({ kind: 'limit', amount: 50000 });
    expect(parseCategoryEntry('Лимит 50к')).toEqual({ kind: 'limit', amount: 50000 });
    expect(parseCategoryEntry('лимит')).toBeNull();
  });
});

describe('дата записи из таблиц месяца', () => {
  const today = new Date(2026, 10, 7);
  it('текущий месяц — сегодня; прошлый — последний день; будущий — первый', () => {
    expect(entryDateForMonth(new Date(2026, 10, 1), today)).toBe(today);
    expect(entryDateForMonth(new Date(2026, 9, 15), today)).toEqual(new Date(2026, 9, 31));
    expect(entryDateForMonth(new Date(2026, 11, 3), today)).toEqual(new Date(2026, 11, 1));
  });
});
