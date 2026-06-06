import { describe, it, expect } from 'vitest';
import { matchExpense, type ExpenseRef } from './_expense-match.js';

const items: ExpenseRef[] = [
  { id: 'e1', description: 'продукты', category: 'food', amount: 5000 },
  { id: 'e2', description: 'такси домой', category: 'transport', amount: 3000 },
  { id: 'e3', description: 'кофе', category: 'food', amount: 1200 },
];

describe('matchExpense', () => {
  it('точная сумма → этот расход', () => {
    expect(matchExpense({ amount: 3000 }, items)?.id).toBe('e2');
  });
  it('fuzzy по описанию (рус. морфология)', () => {
    expect(matchExpense({ description: 'продукты' }, items)?.id).toBe('e1');
    expect(matchExpense({ description: 'такси' }, items)?.id).toBe('e2');
  });
  it('по категории, если описание не дало', () => {
    expect(matchExpense({ category: 'transport' }, items)?.id).toBe('e2');
  });
  it('сумма + текст разводят неоднозначность', () => {
    const two: ExpenseRef[] = [
      { id: 'a', description: 'еда', category: 'food', amount: 5000 },
      { id: 'b', description: 'кроссовки', category: 'clothing', amount: 5000 },
    ];
    expect(matchExpense({ amount: 5000, description: 'кроссовки' }, two)?.id).toBe('b');
  });
  it('нет совпадения → null', () => {
    expect(matchExpense({ description: 'кино' }, items)).toBeNull();
    expect(matchExpense({ amount: 99999 }, items)).toBeNull();
  });
  it('неоднозначная сумма без текста → null (money-safety)', () => {
    const two: ExpenseRef[] = [
      { id: 'a', description: 'еда', category: 'food', amount: 5000 },
      { id: 'b', description: 'обувь', category: 'clothing', amount: 5000 },
    ];
    expect(matchExpense({ amount: 5000 }, two)).toBeNull();
  });
  it('пустой список → null', () => {
    expect(matchExpense({ amount: 5000 }, [])).toBeNull();
  });

  // Регресс ревью (conf 88): коллизия точного совпадения категории/описания
  // НЕ должна возвращать произвольную строку — деньги, не угадываем.
  it('коллизия категории (2 траты food) → null', () => {
    const food: ExpenseRef[] = [
      { id: 'a', description: 'ужин', category: 'food', amount: 12000 },
      { id: 'b', description: 'кофе', category: 'food', amount: 1200 },
    ];
    expect(matchExpense({ category: 'food' }, food)).toBeNull();
  });
  it('одна трата категории → берётся (не коллизия)', () => {
    const mix: ExpenseRef[] = [
      { id: 'a', description: 'ужин', category: 'food', amount: 12000 },
      { id: 'b', description: 'такси', category: 'transport', amount: 3000 },
    ];
    expect(matchExpense({ category: 'food' }, mix)?.id).toBe('a');
  });
  it('сумма + категория, но обе совпали → null', () => {
    const two: ExpenseRef[] = [
      { id: 'a', description: 'ужин', category: 'food', amount: 5000 },
      { id: 'b', description: 'обед', category: 'food', amount: 5000 },
    ];
    expect(matchExpense({ amount: 5000, category: 'food' }, two)).toBeNull();
  });
  it('идентичные описания → null', () => {
    const dup: ExpenseRef[] = [
      { id: 'a', description: 'продукты', category: 'food', amount: 5000 },
      { id: 'b', description: 'продукты', category: 'food', amount: 2000 },
    ];
    expect(matchExpense({ description: 'продукты' }, dup)).toBeNull();
  });
});
