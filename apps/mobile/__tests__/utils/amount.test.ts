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
