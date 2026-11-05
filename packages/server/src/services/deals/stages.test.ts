import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStage, defaultNextStep, isOpenStage, STAGE_LABEL, PARTIAL_PAYMENT } from './stages.js';
import { MAX_MONEY_AMOUNT } from '../../lib/money.js';

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
  it.each(['оплатил аванс', 'оплатил частично', 'внёс предоплату', 'заплатил первую часть', 'оплатил часть'])(
    'нит: частичная оплата «%s» → не выиграна (null)',
    (t) => expect(parseStage(t)).toBeNull(),
  );
  it('полная оплата по-прежнему выиграна', () => {
    expect(parseStage('оплатил')).toBe('won');
    expect(parseStage('оплатил полностью')).toBe('won');
  });
});

describe('PARTIAL_PAYMENT — один на стадии и доход (ревью-3 N4)', () => {
  it.each(['оплатил аванс', 'внёс предоплату', 'первую часть', 'первый платёж', 'оплатил частью', 'частично'])('«%s» → частичная', (t) =>
    expect(PARTIAL_PAYMENT.test(t)).toBe(true));
  it.each(['оплатил полностью', 'участник', 'счастье', 'Ахмет оплатил'])('«%s» → не частичная', (t) =>
    expect(PARTIAL_PAYMENT.test(t)).toBe(false));
  it('сервис и парсер берут один регэксп и один потолок суммы', () => {
    const svc = readFileSync(join(process.cwd(), 'src/services/deals/service.ts'), 'utf-8');
    const parser = readFileSync(join(process.cwd(), 'src/ai/intent-parser.ts'), 'utf-8');
    expect(svc).not.toMatch(/const PARTIAL_PAYMENT/);
    expect(svc).not.toMatch(/1_000_000_000/);
    expect(parser).not.toMatch(/const MAX_MONEY/);
    expect(MAX_MONEY_AMOUNT).toBe(1_000_000_000);
  });
});
