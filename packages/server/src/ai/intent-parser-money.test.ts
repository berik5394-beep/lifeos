import { describe, it, expect } from 'vitest';
import { detectMoneyIntent } from './intent-parser.js';

describe('detectMoneyIntent — надёжный детект денег', () => {
  it('одним сообщением со словом в начале + категория', () => {
    expect(detectMoneyIntent('потратил 15000 на одежду')).toEqual({
      action: 'add_expense', amount: 15000, category: 'одежду', description: 'одежду',
    });
  });
  it('ведущее слово «я» (живой баг) — ловится, категория ОТСУТСТВУЕТ', () => {
    expect(detectMoneyIntent('я потратил 100000')).toEqual({
      action: 'add_expense', amount: 100000,
    });
  });
  it('«сегодня купил на 3000 продукты»', () => {
    expect(detectMoneyIntent('сегодня купил на 3000 продукты')).toEqual({
      action: 'add_expense', amount: 3000, category: 'продукты', description: 'продукты',
    });
  });
  it('число+«на» без глагола → расход', () => {
    expect(detectMoneyIntent('5000 на такси')).toEqual({
      action: 'add_expense', amount: 5000, category: 'такси', description: 'такси',
    });
  });
  it('доход с ведущим словом, источник отсутствует', () => {
    expect(detectMoneyIntent('я получил зарплату 350000')).toEqual({
      action: 'add_income', amount: 350000,
    });
  });
  it('доход с источником', () => {
    expect(detectMoneyIntent('доход 50000 от фриланса')).toEqual({
      action: 'add_income', amount: 50000, source: 'фриланса',
    });
  });
  it('голое число без глагола → null (не ловим любые числа)', () => {
    expect(detectMoneyIntent('100000')).toBeNull();
  });
  it('не-деньги → null', () => {
    expect(detectMoneyIntent('какие задачи на сегодня')).toBeNull();
  });

  // ревью сделок B2: множители — «2 млн» раньше давало сумму 2 и источник «млн от Ахмета».
  it.each([
    ['получил 2 млн от Ахмета', { action: 'add_income', amount: 2_000_000, source: 'Ахмета' }],
    ['получил 2,5 млн от Ахмета', { action: 'add_income', amount: 2_500_000, source: 'Ахмета' }],
    ['получил 3 миллиона от Серика', { action: 'add_income', amount: 3_000_000, source: 'Серика' }],
    ['получил 2000000 от Ахмета', { action: 'add_income', amount: 2_000_000, source: 'Ахмета' }],
    ['получил 2 000 000 от Ахмета', { action: 'add_income', amount: 2_000_000, source: 'Ахмета' }],
    ['доход 1.5 млн', { action: 'add_income', amount: 1_500_000 }],
    ['получил 500 тысяч от Даны', { action: 'add_income', amount: 500_000, source: 'Даны' }],
    ['потратил 5 тыс на такси', { action: 'add_expense', amount: 5000, category: 'такси', description: 'такси' }],
    ['потратил 3000тг на обед', { action: 'add_expense', amount: 3000, category: 'обед', description: 'обед' }],
    ['получил 50000₸ от Серика', { action: 'add_income', amount: 50_000, source: 'Серика' }],
    ['потратил 500к на ремонт', { action: 'add_expense', amount: 500_000, category: 'ремонт', description: 'ремонт' }],
  ])('множитель: «%s»', (text, expected) => {
    expect(detectMoneyIntent(text)).toEqual(expected);
  });

  // Нит ревью: запятая-разделитель тысяч, отделённое «к», регрессы к поведению до B2, потолок.
  it.each([
    ['потратил 1,000 на обед', { action: 'add_expense', amount: 1000, category: 'обед', description: 'обед' }],
    ['получил 1,000,000 от Ахмета', { action: 'add_income', amount: 1_000_000, source: 'Ахмета' }],
    ['получил 2,5 млн от Ахмета', { action: 'add_income', amount: 2_500_000, source: 'Ахмета' }],
    ['потратил 5 к на обед', { action: 'add_expense', amount: 5000, category: 'обед', description: 'обед' }],
    ['получил 5 к', { action: 'add_income', amount: 5000 }],
    ['потратил 500 к ужину', { action: 'add_expense', amount: 500, category: 'к ужину', description: 'к ужину' }],
    // как до B2 (git a788acf): число, приклеенное к слову, — сумма + остаток
    ['потратил 5000кофе', { action: 'add_expense', amount: 5000, category: 'кофе', description: 'кофе' }],
    ['потратил 500р', { action: 'add_expense', amount: 500, category: 'р', description: 'р' }],
  ])('нит: «%s»', (text, expected) => {
    expect(detectMoneyIntent(text)).toEqual(expected);
  });

  it('потолок: больше 1 млрд — не деньги', () => {
    expect(detectMoneyIntent('получил 2000000000 от Ахмета')).toBeNull();
    expect(detectMoneyIntent('получил 5 млрд от Ахмета')).toBeNull();
    expect(detectMoneyIntent('получил 1000000000 от Ахмета')).toEqual({ action: 'add_income', amount: 1_000_000_000, source: 'Ахмета' });
  });
});
