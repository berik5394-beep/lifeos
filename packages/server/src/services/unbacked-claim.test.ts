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

import { isMultiItemRequest, textMentionsHabit } from './jarvis-orchestrator.js';

describe('настоящее время «отмечаю!» — тоже обещание (прод 2026-11-08 22:11)', () => {
  it.each(['Отлично, отмечаю!', 'Записываю на завтра.', 'Добавляю в задачи 👍'])('«%s» → да', (t) =>
    expect(claimsDoneAction(t)).toBe(true),
  );
  it('«ты отмечаешь» / вопрос — нет', () => {
    expect(claimsDoneAction('Ты отмечаешь привычки каждый день?')).toBe(false);
  });
});

describe('textMentionsHabit — фраза про привычку юзера включает инструменты', () => {
  const H = ['Приседать каждый день 50 раз', 'Чтение 20 минут'];
  it.each(['присела 50 раз', 'сделала приседания', 'чтение сегодня готово'])('«%s» → да', (t) =>
    expect(textMentionsHabit(H, t)).toBe(true),
  );
  it.each(['как дела?', 'каждый день одно и то же'])('«%s» → нет', (t) => expect(textMentionsHabit(H, t)).toBe(false));
});

describe('isMultiItemRequest — несколько дел в одном сообщении', () => {
  it.each([
    'Задача на завтра поехать узнать на счет работы\nУзнать как продвигается ипотека\nи встреча с девочками в 14:00',
    'завтра позвонить маме, забрать посылку и встреча с Сериком в 15:00',
  ])('«%s» → да', (t) => expect(isMultiItemRequest(t)).toBe(true));
  it.each(['добавь задачу позвонить маме завтра', 'поставь задачу в 22:00 накормить мужа', 'отметь зарядку'])('«%s» → нет', (t) =>
    expect(isMultiItemRequest(t)).toBe(false),
  );
});
