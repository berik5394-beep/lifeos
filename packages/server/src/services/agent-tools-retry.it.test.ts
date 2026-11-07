import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const runAgent = vi.fn(async (_opts: { localTools?: boolean }) => 'ответ');
vi.mock('./claude-agent.js', () => ({ runAgent: (opts: { localTools?: boolean }) => runAgent(opts) }));
const { handleMessage, mayNeedLocalTools, replyNeedsTools } = await import('./jarvis-orchestrator.js');

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
    runAgent.mockResolvedValueOnce('Извини, я не могу это записать.').mockResolvedValueOnce('Записал задачу «сауна с Серым» на пятницу.');
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
