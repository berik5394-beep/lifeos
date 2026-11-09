import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

type Opts = { localTools?: boolean; system?: string; onToolResult?: (t: string, ok: boolean, r?: unknown) => void };
const runAgent = vi.fn(async (_opts: Opts) => 'ответ');
vi.mock('./claude-agent.js', () => ({ runAgent: (opts: Opts) => runAgent(opts) }));
const { handleMessage, mayNeedLocalTools, replyNeedsTools, HONEST_NOT_DONE, UNBACKED_CLAIM_NOTE } = await import(
  './jarvis-orchestrator.js'
);
/** Заглушка модели, которая РЕАЛЬНО вызвала инструмент записи. */
const wrote = (text: string) => async (o: Opts) => {
  o.onToolResult?.('create_task', true, { message: 'ok' });
  return text;
};

/**
 * Этап 3: фраза вне словаря → агент без инструментов → «не могу записать»
 * (или выдуманное «записал»). Теперь такой ответ — повтор с инструментами.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const user = async () =>
  (await prisma.user.create({ data: { email: `atr-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } })).id;
const PHRASE = 'кстати, впиши: в пятницу сауна с Серым';

describe('ответ без инструментов, а нужно действие → повтор с инструментами', () => {
  it('«не могу записать» → второй заход с инструментами, его ответ уходит пользователю', async () => {
    expect(mayNeedLocalTools(PHRASE)).toBe(false); // фраза вне словаря — иначе тест ничего не проверяет
    runAgent.mockReset();
    runAgent
      .mockResolvedValueOnce('Извини, я не могу это записать.')
      .mockImplementationOnce(wrote('Записал задачу «сауна с Серым» на пятницу.'));
    const r = await handleMessage(await user(), PHRASE);
    expect(runAgent.mock.calls.map((c) => c[0].localTools)).toEqual([false, true]);
    expect(r.reply).toBe('Записал задачу «сауна с Серым» на пятницу.');
  });

  it('обычная болтовня — один заход, без повтора', async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Кот зашёл в бар…');
    await handleMessage(await user(), 'расскажи анекдот про кота');
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});

describe('replyNeedsTools', () => {
  it.each([
    'Извини, я не могу это записать.',
    'К сожалению, не получается сохранить это сейчас.',
    'Записал тебе на пятницу.',
    'Готово, добавила в задачи!',
    'Запомнил: у Серика ДР 8 июня.',
  ])('«%s» → нужен заход с инструментами', (t) => expect(replyNeedsTools(t)).toBe(true));
  it.each(['Кот зашёл в бар…', 'Звучит здорово, хорошего отдыха!', 'Сауна — отличная идея для восстановления.'])(
    '«%s» → нет',
    (t) => expect(replyNeedsTools(t)).toBe(false),
  );
});

describe('сторож «сказал — сделал» (баг 2026-11-09: «создал», а в экранах пусто)', () => {
  const ASK = 'кстати, впиши в задачи: в пятницу сауна с Серым'; // с инструментами, мимо быстрого пути

  it('модель сказала «создал» без вызова → повтор с требованием; повтор записал → его ответ', async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Готово, создал задачу «купить подарок маме»!').mockImplementationOnce(wrote('Записал задачу «купить подарок маме» на сегодня.'));
    const r = await handleMessage(await user(), ASK);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls[1][0].system).toContain(UNBACKED_CLAIM_NOTE);
    expect(runAgent.mock.calls[1][0].localTools).toBe(true);
    expect(r.reply).toBe('Записал задачу «купить подарок маме» на сегодня.');
  });

  it('и повтор снова «создал» без записи → честное «не сделал», а не выдумка', async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Задача создана!').mockResolvedValueOnce('Создала, всё готово.');
    const r = await handleMessage(await user(), ASK);
    expect(r.reply).toBe(HONEST_NOT_DONE);
  });

  it('первый заход реально записал → без повтора', async () => {
    runAgent.mockReset();
    runAgent.mockImplementationOnce(wrote('Создал задачу «купить подарок маме».'));
    const r = await handleMessage(await user(), ASK);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe('Создал задачу «купить подарок маме».');
  });

  it('инструмент вернул «не нашёл» — это не запись → повтор', async () => {
    runAgent.mockReset();
    runAgent
      .mockImplementationOnce(async (o: Opts) => {
        o.onToolResult?.('create_task', true, { error: 'не нашёл' });
        return 'Поставил!';
      })
      .mockResolvedValueOnce('Не получилось записать — не понял, на какой день.');
    const r = await handleMessage(await user(), ASK);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(r.reply).toBe('Не получилось записать — не понял, на какой день.');
  });

  it('вопрос, а не просьба: «ты вчера отметил…» — без повтора', async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Ты вчера отметил 3 привычки из 4 — неплохо!');
    await handleMessage(await user(), 'как у меня с привычками?');
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});

describe('быстрый путь: задача без дня (прод 2026-11-08: zod «date Required» → ничего не создано)', () => {
  it('«поставь задачу купить подарок маме» → задача есть в базе на сегодня', async () => {
    runAgent.mockReset();
    const id = await user();
    const r = await handleMessage(id, 'поставь задачу купить подарок маме');
    const tasks = await prisma.task.findMany({ where: { userId: id } });
    expect(tasks.map((t) => t.title)).toEqual(['купить подарок маме']);
    expect(tasks[0].date.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10)); // timezone UTC
    expect(r.reply).toContain('создана');
  });
});

describe('каждая просьба роботу записана (Berik 2026-11-09)', () => {
  it.each([
    'поставь задачу купить подарок маме',
    'кстати, впиши в задачи: в пятницу сауна с Серым',
    'расскажи анекдот про кота',
    'отметь зарядку',
  ])('«%s» → ровно одна запись вопроса и ответ в истории', async (t) => {
    runAgent.mockReset();
    runAgent.mockResolvedValue('Ок.');
    const id = await user();
    await handleMessage(id, t);
    const rows = await prisma.chatMessage.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } });
    expect(rows.filter((r) => r.role === 'user').map((r) => r.content)).toEqual([t]);
    expect(rows.some((r) => r.role === 'assistant')).toBe(true);
  });
});
