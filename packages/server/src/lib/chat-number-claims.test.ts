import { describe, it, expect } from 'vitest';
import { userNumberClaims, ungroundedClaims } from './chat-number-claims.js';

describe('userNumberClaims — только числа о делах пользователя', () => {
  it('суммы и счётчики', () => {
    expect(userNumberClaims('На еду осталось 12 000 ₸, а сегодня 3 задачи и 5 привычек.').sort()).toEqual(['12000', '3', '5'].sort());
    expect(userNumberClaims('Ты потратил 45000 за неделю')).toEqual(['45000']);
    expect(userNumberClaims('Серия 7 дней подряд!')).toContain('7');
    expect(userNumberClaims('Лимит на развлечения — 20 000 тенге')).toContain('20000');
  });
  it('советы и общие факты не трогаем', () => {
    expect(userNumberClaims('Сделай 3 подхода по 10 повторений')).toEqual([]);
    expect(userNumberClaims('В году 365 дней, а в часе 60 минут')).toEqual([]);
    expect(userNumberClaims('Встань в 7:00 и выпей воды')).toEqual([]);
  });
});

describe('ungroundedClaims', () => {
  const ctx = 'Финансы: потрачено 78 000 из лимита 90 000, осталось 12 000. Задачи на сегодня: 3.';
  it('числа из контекста — честные', () => {
    expect(ungroundedClaims('Осталось 12 000 ₸, задач 3 — успеешь', [ctx])).toEqual([]);
  });
  it('выдуманная сумма ловится', () => {
    expect(ungroundedClaims('Осталось 15 000 ₸ на 10 дней', [ctx])).toEqual(['15000']);
  });
  it('число из слов пользователя — честное', () => {
    expect(ungroundedClaims('Записал 3000 ₸ на продукты', ['потратил 3000 на продукты'])).toEqual([]);
  });
  it('нет утверждений — пусто', () => {
    expect(ungroundedClaims('Привет! Как ты?', [])).toEqual([]);
  });
});

describe('границы слов (кириллица)', () => {
  it('«тг» и «дела» как отдельные слова', () => {
    expect(userNumberClaims('потратил на кофе 900 тг')).toContain('900');
    expect(userNumberClaims('у тебя 4 дела на сегодня')).toContain('4');
    expect(userNumberClaims('3 делегата приехали')).toEqual([]);
  });
});
