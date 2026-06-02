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
});
