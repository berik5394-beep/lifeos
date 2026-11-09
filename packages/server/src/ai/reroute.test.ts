import { describe, it, expect } from 'vitest';
import { rerouteToAgent } from './intent-parser.js';

/** Живой прогон 2026-11-09: Haiku путал перенос/цель/заём с новой задачей/доходом. */
describe('rerouteToAgent', () => {
  const task = { action: 'create_task', title: 'x', date: '2026-11-10' } as const;
  it.each([
    'перенеси звонок маме на завтра',
    'отмени задачу купить хлеб',
    'в ноябре хочу похудеть на 3 кг',
    'хочу к концу года накопить на машину',
    'за месяц хочу выучить 300 слов',
    'на этой неделе хочу закрыть 2 сделки',
  ])('«%s» — агенту', (t) => expect(rerouteToAgent(task as never, t).action).toBe('unknown'));
  it.each(['не забыть бы завтра забрать костюм', 'купить билеты в кино на субботу', 'хочу завтра позвонить нотариусу'])('«%s» — задача', (t) =>
    expect(rerouteToAgent(task as never, t).action).toBe('create_task'),
  );
  it('денежный долг — не задача', () => {
    expect(rerouteToAgent(task as never, 'я должен Серику 50000 до пятницы').action).toBe('unknown');
    expect(rerouteToAgent(task as never, 'должен позвонить нотариусу').action).toBe('create_task');
  });
  it('заём — не доход', () => {
    expect(rerouteToAgent({ action: 'add_income', amount: 100000 } as never, 'Ахмет занял у меня 100 тысяч').action).toBe('unknown');
    expect(rerouteToAgent({ action: 'add_income', amount: 100000 } as never, 'получил зарплату 350000').action).toBe('add_income');
  });
});
