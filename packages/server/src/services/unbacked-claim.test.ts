import { describe, it, expect } from 'vitest';
import { asksForAction, claimsDoneAction, isRealWrite, partialDoneReply } from './jarvis-orchestrator.js';

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

describe('partialDoneReply — сбой модели после реальной записи', () => {
  it('перечисляет записанное и просит не повторять', () => {
    const r = partialDoneReply(['Задача «отчёт» создана на 2026-11-10']);
    expect(r).toContain('• Задача «отчёт» создана на 2026-11-10');
    expect(r).toContain('не повторяй');
    expect(r).not.toContain('НЕ выполнено');
  });
  it('без текстов — всё равно «загляни в списки», не «попробуй ещё раз»', () => {
    expect(partialDoneReply([])).toContain('загляни в списки');
  });
});

describe('аудит 2026-11-09: сторож без ложных срабатываний и без дыр', () => {
  it.each([
    'что у меня запланировано на завтра?',
    'какие привычки я отметил сегодня?',
    'какие встречи на неделе?',
    'сколько я потратил в этом месяце',
  ])('вопрос «%s» — не просьба о действии', (t) => expect(asksForAction(t)).toBe(false));
  it.each(['убери тренировку на завтра', 'сделал отчёт', 'закрой задачу отчёт', 'отметь зарядку?', 'вычеркни покупку хлеба'])(
    '«%s» — просьба',
    (t) => expect(asksForAction(t)).toBe(true),
  );
  it.each(['Закрыл задачу «отчёт» ✅', 'Задача «отчёт» выполнена ✅', 'Отменил встречу с Сериком', 'Напомню завтра утром!', 'Встреча перенесена на пятницу'])(
    'выдумка «%s» — ловим',
    (t) => expect(claimsDoneAction(t)).toBe(true),
  );
  it.each(['Не записал: в 14:00 уже встреча. Поставить на 15:00?', 'Пока не отметил — какую привычку?'])(
    'честный отказ «%s» — не обещание',
    (t) => expect(claimsDoneAction(t)).toBe(false),
  );
  it('погода/билеты — не запись; письмо — запись', () => {
    expect(isRealWrite('get_weather', { message: 'солнце' })).toBe(false);
    expect(isRealWrite('send_email', { sent: true })).toBe(true);
  });
});

describe('жалоба «не сделал» — не просьба о действии (2026-11-10, тест характера)', () => {
  it('сторож не подменяет тёплый ответ заготовкой «Стоп, честно»', async () => {
    const { asksForAction } = await import('./jarvis-orchestrator.js');
    expect(asksForAction('Я сегодня не сделал ни одной задачи')).toBe(false);
    expect(asksForAction('Ничего не успела сегодня')).toBe(false);
    expect(asksForAction('я не успел позвонить маме')).toBe(false);
    // с просьбой — по-прежнему действие
    expect(asksForAction('не сделал отчёт, перенеси на завтра')).toBe(true);
    expect(asksForAction('Сделал зарядку')).toBe(true);
  });
});

describe('рассказ робота о себе — не ложное «записал» (тест характера 2026-11-10)', () => {
  it('«кто ты / расскажи о себе / что умеешь» — сторож не вмешивается', async () => {
    const { asksAboutRobot } = await import('./jarvis-orchestrator.js');
    for (const t of ['Расскажи о себе — кто ты?', 'Кто ты?', 'Что ты умеешь?', 'чем ты можешь помочь', 'Ты кто такой']) expect(asksAboutRobot(t), t).toBe(true);
    for (const t of ['Запиши задачу', 'Кто такой Серик?', 'Расскажи про инвестиции', 'Отметь зарядку']) expect(asksAboutRobot(t), t).toBe(false);
  });
});
