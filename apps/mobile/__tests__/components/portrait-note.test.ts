import { portraitNote } from '@/components/memory/portrait-card';

describe('portraitNote — подпись блока «Каким я тебя вижу»', () => {
  it('мало фактов — просим рассказать', () => {
    expect(portraitNote({ status: 'need_more', text: null, updatedAt: null, basedOn: 2 }, false)).toMatch(/расскажи о себе/);
  });
  it('готов — когда и по скольким фактам', () => {
    expect(portraitNote({ status: 'ok', text: 'x', updatedAt: '2026-11-07T12:00:00Z', basedOn: 14 }, false)).toMatch(/Обновлено 7 ноября · по 14 фактам/);
  });
  it('не вышло честно / сеть — предложить обновить', () => {
    expect(portraitNote({ status: 'unavailable', text: null, updatedAt: null, basedOn: 9 }, false)).toMatch(/потяни вниз/);
    expect(portraitNote(null, true)).toMatch(/потяни вниз/);
  });
});

it('склонение: по 21 факту', () => {
  expect(portraitNote({ status: 'ok', text: 'x', updatedAt: '2026-11-07T12:00:00Z', basedOn: 21 }, false)).toMatch(/по 21 факту о тебе/);
});
