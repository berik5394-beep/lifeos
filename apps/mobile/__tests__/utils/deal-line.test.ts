import { parseDealLine } from '@/utils/deal-line';

describe('строка «Новая сделка»', () => {
  it.each([
    ['Ахмет — оборудование 2 млн', { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }],
    ['Дана склад 800к', { personName: 'Дана', title: 'склад', amount: 800_000 }],
    ['Серик', { personName: 'Серик', title: null, amount: null }],
    ['ТОО Альфа: сервис 1 500 000', { personName: 'ТОО Альфа', title: 'сервис', amount: 1_500_000 }],
  ])('«%s»', (raw, want) => expect(parseDealLine(raw)).toEqual(want));
  it('пусто — нет', () => expect(parseDealLine('  ')).toBeNull());
});
