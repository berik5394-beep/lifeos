import { describe, it, expect } from 'vitest';
import { deterministicIntent } from './intent-parser.js';

/**
 * SSOT invariant — booking-routing (Step 8).
 *
 * Решение по тесту, не по страху: спека требует 10 booking-фраз →
 * travel, не create_task. Если проходит → детерминированный
 * booking-prefilter в intent-parser ОСТАЁТСЯ (он — доказанный слой
 * корректности: Claude систематически путал booking с create_task,
 * + Step 6 эмпирически показал, что удаление детерминированного
 * money-слоя регрессирует #1). intent-parser.ts НЕ удаляется.
 */

const BOOKING = [
  'Забронируй рейс Алматы-Астана на завтра',
  'Закажи такси до аэропорта',
  'Купи билеты в Бангкок на 20 мая',
  'Найди мне отель в Астане',
  'Найди билет в Москву на пятницу',
  'Полечу в Стамбул в субботу',
  'Хочу слетать в Дубай',
  'Нужен отель в Сочи на 5 ночей',
  'Спланируй поездку в Анталию',
  'Съездить в Караганду на выходные',
];

describe('10 booking-фраз → plan_travel (не create_task)', () => {
  it.each(BOOKING)('«%s» → plan_travel', (phrase) => {
    const r = deterministicIntent(phrase);
    expect(r?.action).toBe('plan_travel');
    expect(r?.action).not.toBe('create_task');
  });
});

describe('booking-prefilter не ловит лишнее (нет travel-сущности)', () => {
  it('«Купи продукты завтра» НЕ plan_travel', () => {
    expect(deterministicIntent('Купи продукты завтра')?.action).not.toBe(
      'plan_travel',
    );
  });
  it('«Закажи пиццу» НЕ plan_travel', () => {
    expect(deterministicIntent('Закажи пиццу')?.action).not.toBe('plan_travel');
  });
});

describe('ISSUE-5: «закрой задачу X» → complete_task (не complete_habit)', () => {
  it('«Закрой задачу отчёт» → complete_task', () => {
    const r = deterministicIntent('Закрой задачу отчёт');
    expect(r?.action).toBe('complete_task');
    expect(r?.taskTitle).toBe('отчёт');
  });
  it('«Заверши задачу подготовить презентацию» → complete_task', () => {
    const r = deterministicIntent('Заверши задачу подготовить презентацию');
    expect(r?.action).toBe('complete_task');
    expect(r?.taskTitle).toBe('подготовить презентацию');
  });
  it('«Выполни задачу купить хлеб» → complete_task', () => {
    expect(deterministicIntent('Выполни задачу купить хлеб')?.action).toBe(
      'complete_task',
    );
  });
  it('регресс не сломан: «Закрой бег» → complete_habit', () => {
    expect(deterministicIntent('Закрой бег')?.action).toBe('complete_habit');
  });
  it('регресс не сломан: «Отметь привычку чтение» → complete_habit', () => {
    const r = deterministicIntent('Отметь привычку чтение');
    expect(r?.action).toBe('complete_habit');
  });
  it('create_task не задет: «Создай задачу позвонить маме» → create_task', () => {
    expect(deterministicIntent('Создай задачу позвонить маме')?.action).toBe(
      'create_task',
    );
  });
});
