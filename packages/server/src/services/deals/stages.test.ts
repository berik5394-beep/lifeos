import { describe, it, expect } from 'vitest';
import { parseStage, defaultNextStep, isOpenStage, STAGE_LABEL } from './stages.js';

describe('стадии сделки', () => {
  it.each([
    ['proposal', 'proposal'],
    ['отправил КП', 'proposal'],
    ['коммерческое предложение', 'proposal'],
    ['переговоры', 'talks'],
    ['обсуждаем', 'talks'],
    ['договор', 'contract'],
    ['ждём оплату', 'contract'],
    ['счёт выставил', 'contract'],
    ['оплатил', 'won'],
    ['выиграли', 'won'],
    ['отказался', 'lost'],
    ['проиграна', 'lost'],
    ['новая', 'new'],
    ['заявка', 'new'],
  ])('%s → %s', (raw, stage) => {
    expect(parseStage(raw)).toBe(stage);
  });
  it.each(['не оплатил', 'ещё не заплатил', 'пока не купил', 'договорились о встрече'])(
    'нит: «%s» — не выиграна и не договор (null)',
    (raw) => expect(parseStage(raw)).toBeNull(),
  );
  it('договор без «-ились» — всё ещё договор', () => {
    expect(parseStage('договор подписали')).toBe('contract');
    expect(parseStage('отправил договор')).toBe('contract');
  });
  it('непонятное → null', () => {
    expect(parseStage('погода')).toBeNull();
    expect(parseStage('')).toBeNull();
  });
  it('открытые стадии', () => {
    expect(isOpenStage('proposal')).toBe(true);
    expect(isOpenStage('won')).toBe(false);
    expect(isOpenStage('lost')).toBe(false);
  });
  it('шаг по умолчанию: КП → спросить ответ через 3 дня', () => {
    expect(defaultNextStep('proposal', '2026-11-05')).toEqual({ date: '2026-11-08', text: 'спросить ответ по КП' });
    expect(defaultNextStep('new', '2026-11-30')).toEqual({ date: '2026-12-02', text: 'связаться' });
    expect(defaultNextStep('talks', '2026-11-05')?.date).toBe('2026-11-10');
    expect(defaultNextStep('contract', '2026-11-05')?.text).toBe('проверить оплату');
  });
  it('у закрытых шага нет', () => {
    expect(defaultNextStep('won', '2026-11-05')).toBeNull();
    expect(defaultNextStep('lost', '2026-11-05')).toBeNull();
  });
  it('подписи на русском', () => {
    expect(STAGE_LABEL.proposal).toBe('КП отправлено');
    expect(STAGE_LABEL.contract).toBe('Договор/оплата');
  });
});
