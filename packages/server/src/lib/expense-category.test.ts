import { describe, it, expect } from 'vitest';
import { normalizeExpenseCategory } from './expense-category.js';

describe('normalizeExpenseCategory', () => {
  it('канонический ключ остаётся как есть', () => {
    expect(normalizeExpenseCategory('food')).toBe('food');
    expect(normalizeExpenseCategory('Transport')).toBe('transport');
    expect(normalizeExpenseCategory('other')).toBe('other');
  });
  it('русские ответы на «на что?» → ключ графика', () => {
    expect(normalizeExpenseCategory('еда')).toBe('food');
    expect(normalizeExpenseCategory('на продукты')).toBe('food');
    expect(normalizeExpenseCategory('бензин')).toBe('transport');
    expect(normalizeExpenseCategory('Такси')).toBe('transport');
    expect(normalizeExpenseCategory('кроссовки')).toBe('clothing');
    expect(normalizeExpenseCategory('аптека')).toBe('health');
    expect(normalizeExpenseCategory('коммуналка')).toBe('home');
    expect(normalizeExpenseCategory('кино')).toBe('entertainment');
    expect(normalizeExpenseCategory('прочее')).toBe('other');
  });
  it('без категории — по описанию', () => {
    expect(normalizeExpenseCategory(undefined, 'обед с Сериком')).toBe('food');
    expect(normalizeExpenseCategory('', 'заправил машину')).toBe('transport');
  });
  it('незнакомое → other', () => {
    expect(normalizeExpenseCategory('компьютер')).toBe('other');
    expect(normalizeExpenseCategory(undefined, undefined)).toBe('other');
  });
  it('не путает части слов: «зал» не ловит «зализать», но ловит «спортзал»', () => {
    expect(normalizeExpenseCategory('спортзал')).toBe('health');
    expect(normalizeExpenseCategory('абонемент в зал')).toBe('health');
  });
});
