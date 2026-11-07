import { describe, it, expect } from 'vitest';
import { delegationHints, delegationLine, durationMin, meetingCostLine, timeValueContextLines } from './time-value.js';
import { toPersonType } from '../tools/set-person-type.js';

describe('время = деньги', () => {
  it('длительность встречи', () => {
    expect(durationMin('14:00', '16:00')).toBe(120);
    expect(durationMin('14:00', null)).toBeNull();
    expect(durationMin('16:00', '14:00')).toBeNull();
  });
  it('цена длинной встречи — названная и оценка', () => {
    expect(meetingCostLine('Совещание', 120, { rate: 20000, source: 'set' })).toBe(
      '«Совещание» — 2 ч ≈ 40 000 ₸ твоего времени. Нужно ли тебе там быть всё время?',
    );
    expect(meetingCostLine('Планёрка', 90, { rate: 10000, source: 'income' })).toBe(
      '«Планёрка» — 1,5 ч ≈ 15 000 ₸ твоего времени (примерно, по доходу). Нужно ли тебе там быть всё время?',
    );
  });
  it('короткая встреча / нет цены часа — молчим', () => {
    expect(meetingCostLine('Созвон', 30, { rate: 20000, source: 'set' })).toBeNull();
    expect(meetingCostLine('Совещание', 120, null)).toBeNull();
  });
});

describe('команда', () => {
  const team = [
    { name: 'Айгуль', role: 'бухгалтер' },
    { name: 'Ерлан', role: 'продажи' },
  ];
  it('задача по части роли / по имени → «передать?»', () => {
    const h = delegationHints(['Сверить акты с поставщиком', 'Купить хлеб', 'Обзвонить новых клиентов', 'Попросить Айгуль про НДС'], team);
    expect(h.map((x) => [x.task, x.member.name])).toEqual([
      ['Сверить акты с поставщиком', 'Айгуль'],
      ['Обзвонить новых клиентов', 'Ерлан'],
    ]);
    expect(delegationLine(h[0])).toBe('«Сверить акты с поставщиком» — по части Айгуль (бухгалтер). Передать?');
  });
  it('нет совпадения — нет подсказки', () => {
    expect(delegationHints(['Купить хлеб', 'Позвонить маме'], team)).toEqual([]);
  });
  it('контекст мозга', () => {
    expect(timeValueContextLines({ rate: 20000, source: 'set' }, team)).toEqual([
      'Цена часа пользователя: 20 000 ₸ (названа им).',
      'Команда пользователя: Айгуль — бухгалтер; Ерлан — продажи.',
    ]);
    expect(timeValueContextLines(null, [])).toEqual([]);
  });
  it('тип человека по-русски', () => {
    expect(toPersonType('сотрудник')).toBe('team');
    expect(toPersonType('наш бухгалтер')).toBe('team');
    expect(toPersonType('клиент')).toBe('client');
    expect(toPersonType('team')).toBe('team');
  });
});
