import {
  planLine,
  planProgress,
  planHint,
  groupTitle,
  dealHead,
  stepLine,
  closedLine,
  stepTone,
  eventText,
  eventLine,
  incomeOfferText,
  canRecordIncome,
  reopenStage,
  parseMoneyInput,
  civilToday,
  stepDateChoices,
  fmtAmountInput,
  LOST_REASONS,
} from '@/services/deals-view';
import type { Deal, DealEvent, PlanStatus } from '@/services/deals';

const deal: Deal = {
  id: 'd1', personEntityId: null, personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, currency: '₸',
  stage: 'proposal', stageChangedAt: '', nextStepAt: '2026-11-08T00:00:00.000Z', nextStepText: 'спросить ответ по КП',
  lastActivityAt: '', closedAt: null, lostReason: null, wonIncomeId: null, createdAt: '', updatedAt: '',
};
const plan: PlanStatus = {
  plan: 10_000_000, won: 4_000_000, open: 2_000_000, noAmount: 1,
  pace: { behind: true, expected: 5_000_000, gap: 6_000_000, coverable: false }, covering: [],
};
const ev = (p: Partial<DealEvent>): DealEvent => ({ id: 'e', dealId: 'd1', kind: 'note', from: null, to: null, text: null, at: '2026-11-05T10:00:00.000Z', ...p });

describe('панель сделок — что показываем', () => {
  it('полоска плана: «План месяца: X из Y», доля 0..1', () => {
    expect(planLine(plan)).toBe('План месяца: 4 млн ₸ из 10 млн ₸');
    expect(planProgress(plan)).toBeCloseTo(0.4);
    expect(planProgress({ ...plan, won: 12_000_000 })).toBe(1);
    expect(planProgress({ ...plan, plan: 0 })).toBe(0);
  });
  it('подсказка темпа: отстаёшь — разрыв и кто закроет; без сумм — отдельно', () => {
    expect(planHint(plan)).toBe('Отстаёшь: до плана 6 млн ₸, открытых сделок не хватает. 1 сделка без суммы');
    expect(planHint({ ...plan, covering: ['Ахмет', 'Дана'], pace: { ...plan.pace, coverable: true }, noAmount: 0 }))
      .toBe('Отстаёшь: до плана 6 млн ₸ — закроют Ахмет, Дана');
    expect(planHint({ ...plan, pace: { ...plan.pace, behind: false }, noAmount: 0 })).toBeNull();
    expect(planHint({ ...plan, pace: { ...plan.pace, behind: false }, noAmount: 3 })).toBe('3 сделки без суммы');
  });
  it('заголовок стадии с суммой; без суммы — просто стадия', () => {
    expect(groupTitle({ stage: 'proposal', deals: [deal], sum: 2_000_000 })).toBe('КП отправлено · 2 млн ₸');
    expect(groupTitle({ stage: 'new', deals: [deal], sum: 0 })).toBe('Новая');
  });
  it('строка сделки и шаг с датой', () => {
    expect(dealHead(deal)).toBe('Ахмет — оборудование');
    expect(stepLine(deal)).toBe('спросить ответ по КП · 08.11');
    expect(stepLine({ ...deal, nextStepText: null })).toBeNull();
  });
  it('закрытая сделка: итог и причина', () => {
    expect(closedLine({ ...deal, stage: 'won' })).toBe('Выиграна · 2 млн ₸');
    expect(closedLine({ ...deal, stage: 'won', wonIncomeId: 'i1' })).toBe('Выиграна · 2 млн ₸ · доход записан');
    expect(closedLine({ ...deal, stage: 'lost', lostReason: 'дорого' })).toBe('Проиграна: дорого');
    expect(closedLine({ ...deal, stage: 'lost', amount: null })).toBe('Проиграна');
  });
  it('шаг: просрочен / сегодня / потом', () => {
    expect(stepTone(deal, '2026-11-09')).toBe('overdue');
    expect(stepTone(deal, '2026-11-08')).toBe('today');
    expect(stepTone(deal, '2026-11-07')).toBe('later');
    expect(stepTone({ ...deal, nextStepAt: null }, '2026-11-07')).toBe('later');
  });
  it('история событий по-русски', () => {
    expect(eventText(ev({ kind: 'created', to: 'new' }))).toBe('сделка заведена');
    expect(eventText(ev({ kind: 'stage', from: 'new', to: 'talks' }))).toBe('стадия: Переговоры');
    expect(eventText(ev({ kind: 'amount', to: '2000000' }))).toBe('сумма: 2 млн ₸');
    expect(eventText(ev({ kind: 'amount', to: null }))).toBe('сумма: —');
    expect(eventText(ev({ kind: 'next_step', to: '2026-11-10', text: 'позвонить' }))).toBe('шаг: позвонить · 10.11');
    expect(eventText(ev({ kind: 'note', text: 'аванс 500 000' }))).toBe('аванс 500 000');
  });
  it('строка истории — дата события по часам устройства', () => {
    const at = new Date(2026, 10, 5, 23, 30).toISOString();
    expect(eventLine(ev({ kind: 'note', text: 'созвонились', at }))).toBe('05.11 · созвонились');
  });
  it('предложение дохода — точная сумма, без округления до млн', () => {
    expect(incomeOfferText({ ...deal, amount: 2_345_678 })).toBe('Записать доход 2 345 678 ₸?');
  });
  it('кнопка «Записать доход»: только выигранная, с суммой, ещё без дохода', () => {
    expect(canRecordIncome({ ...deal, stage: 'won' })).toBe(true);
    expect(canRecordIncome({ ...deal, stage: 'won', wonIncomeId: 'i1' })).toBe(false);
    expect(canRecordIncome({ ...deal, stage: 'won', amount: null })).toBe(false);
    expect(canRecordIncome(deal)).toBe(false);
  });
  it('вернуть в работу — в стадию, откуда закрыли (по истории); не знаем — null (спросим), а не молча «Переговоры»', () => {
    const events = [ev({ kind: 'stage', from: 'contract', to: 'won' }), ev({ kind: 'stage', from: 'new', to: 'contract' })];
    expect(reopenStage({ ...deal, stage: 'won' }, events)).toBe('contract');
    expect(reopenStage({ ...deal, stage: 'lost' }, [])).toBeNull();
    expect(reopenStage({ ...deal, stage: 'lost' }, [ev({ kind: 'stage', from: 'won', to: 'lost' })])).toBeNull();
  });
  it('ввод суммы: пробелы, «млн», «к», запятая; пусто — null; мусор/ноль/больше 1 млрд — ошибка', () => {
    expect(parseMoneyInput('2 000 000')).toEqual({ ok: true, value: 2_000_000 });
    expect(parseMoneyInput('2,5 млн')).toEqual({ ok: true, value: 2_500_000 });
    expect(parseMoneyInput('500к')).toEqual({ ok: true, value: 500_000 });
    expect(parseMoneyInput('  ')).toEqual({ ok: true, value: null });
    expect(parseMoneyInput('много')).toMatchObject({ ok: false });
    expect(parseMoneyInput('0')).toMatchObject({ ok: false });
    expect(parseMoneyInput('2000000000')).toMatchObject({ ok: false });
  });
  it('ввод суммы без суффикса: «,»/«.» + ровно 3 цифры — разделитель тысяч, не дробь', () => {
    expect(parseMoneyInput('350,000')).toEqual({ ok: true, value: 350_000 });
    expect(parseMoneyInput('2.000.000')).toEqual({ ok: true, value: 2_000_000 });
    expect(parseMoneyInput('1,500')).toEqual({ ok: true, value: 1_500 });
    expect(parseMoneyInput('2,000,000 ₸')).toEqual({ ok: true, value: 2_000_000 });
  });
  it('ввод суммы с суффиксом: дробь можно', () => {
    expect(parseMoneyInput('1,5к')).toEqual({ ok: true, value: 1_500 });
    expect(parseMoneyInput('2,5 млн')).toEqual({ ok: true, value: 2_500_000 });
    expect(parseMoneyInput('1.5 тыс')).toEqual({ ok: true, value: 1_500 });
  });
  it('дробь без суффикса — ошибка «Сумма — целое число»; смешанные разделители — ошибка', () => {
    expect(parseMoneyInput('12,5')).toEqual({ ok: false, error: 'Сумма — целое число' });
    expect(parseMoneyInput('1500.50')).toEqual({ ok: false, error: 'Сумма — целое число' });
    expect(parseMoneyInput('1,000.000')).toMatchObject({ ok: false });
  });
  it('ошибки ввода суммы — с понятным текстом', () => {
    expect(parseMoneyInput('много')).toEqual({ ok: false, error: 'Сумма — число, например 2 000 000' });
    expect(parseMoneyInput('0')).toEqual({ ok: false, error: 'Сумма должна быть больше нуля' });
    expect(parseMoneyInput('2000000000')).toEqual({ ok: false, error: 'Слишком большая сумма — максимум 1 млрд ₸' });
  });
  it('сегодня — локальная civil-дата устройства', () => {
    expect(civilToday(new Date(2026, 10, 5, 23, 30))).toBe('2026-11-05');
  });
  it('причины проигрыша', () => {
    expect(LOST_REASONS).toEqual(['дорого', 'выбрал другого', 'не актуально']);
  });
  it('шаг: быстрые даты по часам устройства — сегодня, завтра, через 3 дня, через неделю (через конец месяца)', () => {
    expect(stepDateChoices(new Date(2026, 10, 28, 23, 50))).toEqual([
      { label: 'Сегодня', date: '2026-11-28' },
      { label: 'Завтра', date: '2026-11-29' },
      { label: 'Через 3 дня', date: '2026-12-01' },
      { label: 'Через неделю', date: '2026-12-05' },
    ]);
  });
  it('сумма в поле — с пробелами по тысячам; нет суммы — пусто', () => {
    expect(fmtAmountInput(10_000_000)).toBe('10 000 000');
    expect(fmtAmountInput(2_345_678.4)).toBe('2 345 678');
    expect(fmtAmountInput(null)).toBe('');
  });
});
