import { describe, it, expect } from 'vitest';
import { asksForAction, claimsDoneAction, isRealWrite } from './jarvis-orchestrator.js';

/** Баг 2026-11-09: робот «создал», а в экранах пусто. Распознавание обещаний. */
describe('claimsDoneAction — робот утверждает, что сделал', () => {
  it.each([
    'Создал задачу «отчёт» на завтра.',
    'Готово! Добавила привычку «Чтение».',
    'Записал: встреча с Сериком в 15:00.',
    'Поставил цель накопить миллион 💪',
    'Задача «купить хлеб» создана.',
    'Привычка добавлена, начнём завтра!',
    'Цель записана.',
    'Закинул в план на четверг.',
  ])('«%s» → да', (t) => expect(claimsDoneAction(t)).toBe(true));

  it.each([
    'Ты вчера отметил 3 привычки — молодец.',
    'Вы уже добавили эту задачу раньше.',
    'Хочешь, создам задачу?',
    'Могу записать это как привычку — скажи «да».',
    'У тебя 3 задачи на сегодня.',
    'Не получилось записать — уточни день.',
  ])('«%s» → нет', (t) => expect(claimsDoneAction(t)).toBe(false));
});

describe('asksForAction — пользователь просит сделать', () => {
  it.each(['поставь задачу купить хлеб', 'создай привычку бегать', 'хочу цель — накопить 5 млн', 'впиши встречу на пятницу', 'запиши трату 5000'])(
    '«%s» → да',
    (t) => expect(asksForAction(t)).toBe(true),
  );
  it.each(['расскажи анекдот', 'как дела?', 'какая погода'])('«%s» → нет', (t) => expect(asksForAction(t)).toBe(false));
});

describe('isRealWrite', () => {
  it('запись с итогом — да; чтение, «не нашёл», неизвестный — нет', () => {
    expect(isRealWrite('create_task', { message: 'Задача создана' })).toBe(true);
    expect(isRealWrite('create_habit', { habitId: 'x' })).toBe(true);
    expect(isRealWrite('get_tasks', { tasks: [] })).toBe(false);
    expect(isRealWrite('create_task', { error: 'не нашёл' })).toBe(false);
    expect(isRealWrite('no_such_tool', {})).toBe(false);
  });
});
