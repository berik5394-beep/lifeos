import { describe, it, expect } from 'vitest';
import {
  fmtMoney, fmtMoneyExact, whenPhrase, describeCreated, describeUpdated, describeList,
  formatDealsSection, dealBriefLine, describePlan, instrumental, genitive, accusative, describeWhichDeal,
  dealStepLabel,
} from './format.js';

const base = { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 as number | null };

describe('тексты сделок', () => {
  it('деньги', () => {
    expect(fmtMoney(2_000_000)).toBe('2 млн ₸');
    expect(fmtMoney(1_500_000)).toBe('1,5 млн ₸');
    expect(fmtMoney(350_000)).toBe('350 000 ₸');
  });
  it('когда', () => {
    expect(whenPhrase('2026-11-05', '2026-11-05')).toBe('сегодня');
    expect(whenPhrase('2026-11-06', '2026-11-05')).toBe('завтра');
    expect(whenPhrase('2026-11-10', '2026-11-05')).toBe('во вторник (10.11)');
  });
  it('создание: клиент отмечен, шаг назван', () => {
    const t = describeCreated({ ...base, stage: 'new' }, true, { date: '2026-11-07', text: 'связаться' }, '2026-11-05');
    expect(t).toBe('Записал сделку: Ахмет — оборудование, 2 млн ₸, стадия «Новая». Ахмета отметил клиентом. Напомню связаться в субботу (07.11).');
  });
  it('создание без суммы — без выдумки', () => {
    const t = describeCreated({ ...base, amount: null, stage: 'new' }, false, null, '2026-11-05');
    expect(t).toBe('Записал сделку: Ахмет — оборудование, стадия «Новая».');
  });
  it('смена стадии + предложение дохода', () => {
    const t = describeUpdated({ ...base, stage: 'won' }, { stageChanged: true, step: null, incomeOffer: true }, '2026-11-05');
    expect(t).toBe('Сделка Ахмет — оборудование: стадия «Выиграна». Записать доход 2 000 000 ₸ от Ахмета?');
  });
  it('нит: денежный вопрос — точная сумма, не округлённая', () => {
    const t = describeUpdated({ ...base, amount: 2_345_678, stage: 'won' }, { stageChanged: true, step: null, incomeOffer: true }, '2026-11-05');
    expect(t).toContain('Записать доход 2 345 678 ₸ от Ахмета?');
    const c = describeCreated({ ...base, amount: 2_345_678, stage: 'won' }, false, null, '2026-11-05', true);
    expect(c).toBe('Записал сделку: Ахмет — оборудование, 2,3 млн ₸, стадия «Выиграна». Записать доход 2 345 678 ₸ от Ахмета?');
    expect(fmtMoneyExact(2_345_678)).toBe('2 345 678 ₸');
  });
  it('выиграна без суммы — просим сумму', () => {
    const t = describeUpdated({ ...base, amount: null, stage: 'won' }, { stageChanged: true, step: null, incomeOffer: false }, '2026-11-05');
    expect(t).toContain('Скажи сумму — запишу доход.');
  });
  it('список: по стадиям, шаги сегодня', () => {
    const t = describeList(
      [
        { ...base, stage: 'proposal', nextStepAt: '2026-11-05', nextStepText: 'спросить ответ по КП' },
        { personName: 'Серик', title: 'сделка', amount: null, stage: 'talks', nextStepAt: '2026-11-09', nextStepText: 'следующий контакт' },
      ],
      '2026-11-05',
    );
    expect(t).toContain('Открыто 2 сделки на 2 млн ₸');
    expect(t).toContain('КП отправлено: Ахмет — оборудование (2 млн ₸)');
    expect(t).toContain('Сегодня: Ахмет — спросить ответ по КП');
  });
  it('пустой список', () => {
    expect(describeList([], '2026-11-05')).toBe('Открытых сделок нет. Скажи «Ахмет хочет … на 2 млн» — заведу.');
  });
  it('план', () => {
    expect(describePlan({ plan: 10_000_000, won: 4_000_000, open: 7_000_000, behind: true, covering: ['Ахмет', 'Серик'], noAmount: 1 }))
      .toBe('План месяца 10 млн ₸: закрыто 4 млн ₸, в работе ещё 7 млн ₸. Успеешь, если закроешь Ахмета и Серика. У 1 сделки нет суммы.');
  });
  it('блок контекста и строка брифа', () => {
    expect(formatDealsSection({ openCount: 3, openSum: 5_000_000, clients: ['Ахмет', 'Дана', 'Ахмет'], dueToday: ['Ахмет'], overdue: ['Дана'], plan: null }))
      .toBe('Сделки: открыто 3 на 5 млн ₸; клиенты в работе: Ахмет, Дана; шаг сегодня: Ахмет; просрочен шаг: Дана.');
    expect(formatDealsSection({ openCount: 0, openSum: 0, clients: [], dueToday: [], overdue: [], plan: null })).toBeNull();
    expect(dealBriefLine({ title: 'оборудование', amount: 2_000_000, stage: 'proposal', daysInStage: 4 }))
      .toBe('Сделка «оборудование» 2 млн ₸, КП отправлено 4 дн назад.');
  });
  it('строка брифа — живые фразы по стадиям, 0 дн = «сегодня»', () => {
    const line = (stage: string, daysInStage: number) => dealBriefLine({ title: 'x', amount: null, stage, daysInStage });
    expect(line('proposal', 0)).toBe('Сделка «x», КП отправлено сегодня.');
    expect(line('contract', 3)).toBe('Сделка «x», договор/оплата — 3 дн.');
    expect(line('contract', 0)).toBe('Сделка «x», договор/оплата — сегодня.');
    expect(line('talks', 4)).toBe('Сделка «x», переговоры идут 4 дн.');
    expect(line('talks', 0)).toBe('Сделка «x», переговоры начались сегодня.');
    expect(line('new', 2)).toBe('Сделка «x», новая, 2 дн.');
    expect(line('new', 0)).toBe('Сделка «x», новая, сегодня.');
  });
});

describe('творительный падеж', () => {
  it('имена', () => {
    expect(instrumental('Дана')).toBe('Даной');
    expect(instrumental('Ахмет')).toBe('Ахметом');
    expect(instrumental('Аля')).toBe('Алей');
  });
});

describe('ревью I5: модель видит, у кого открыта сделка', () => {
  it('клиенты: без дублей, не больше 8', () => {
    const many = ['А1', 'А2', 'А3', 'А4', 'А5', 'А6', 'А7', 'А8', 'А9', 'А1'];
    const t = formatDealsSection({ openCount: 10, openSum: 0, clients: many, dueToday: [], overdue: [], plan: null });
    expect(t).toBe('Сделки: открыто 10; клиенты в работе: А1, А2, А3, А4, А5, А6, А7, А8.');
  });
});

describe('нит: падежи и число', () => {
  it('родительный: -а/-я → -ы/-и', () => {
    expect(genitive('Ахмет')).toBe('Ахмета');
    expect(genitive('Дана')).toBe('Даны');
    expect(genitive('Аля')).toBe('Али');
    expect(genitive('Ольга')).toBe('Ольги');
    expect(genitive('Алексей')).toBe('Алексея');
  });
  it('винительный: «закроешь Дану», «отметил Ахмета»', () => {
    expect(accusative('Ахмет')).toBe('Ахмета');
    expect(accusative('Дана')).toBe('Дану');
    expect(accusative('Аля')).toBe('Алю');
  });
  it('тексты используют верный падеж', () => {
    expect(describeCreated({ personName: 'Дана', title: 'склад', amount: null, stage: 'new' }, true, null, '2026-11-05'))
      .toBe('Записал сделку: Дана — склад, стадия «Новая». Дану отметил клиентом.');
    expect(describePlan({ plan: 10_000_000, won: 0, open: 9_000_000, behind: true, covering: ['Дана', 'Ахмет'], noAmount: 0 }))
      .toContain('Успеешь, если закроешь Дану и Ахмета.');
  });
  it('«У Ахмета 5 открытых сделок»', () => {
    const d = (title: string) => ({ title, amount: null });
    expect(describeWhichDeal('Ахмет', ['а', 'б', 'в', 'г', 'д'].map(d))).toMatch(/^У Ахмета 5 открытых сделок: /);
    expect(describeWhichDeal('Дана', ['а', 'б'].map(d))).toBe('У Даны 2 открытые сделки: «а», «б». Про какую?');
  });
});

describe('шаг по сделке — подпись', () => {
  it('клиент — шаг; без текста шага — «шаг по сделке»', () => {
    expect(dealStepLabel({ personName: 'Ахмет', nextStepText: 'связаться' })).toBe('Ахмет — связаться');
    expect(dealStepLabel({ personName: 'Дана', nextStepText: null })).toBe('Дана — шаг по сделке');
  });
});
