import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { eventRoutes } from '../routes/events.js';
import { taskRoutes } from '../routes/tasks.js';
import { moveEventTool } from '../tools/move-event.js';
import { cancelEventTool } from '../tools/cancel-event.js';
import { moveTaskTool } from '../tools/move-task.js';
import { addCivilDays, localDateStr } from '../lib/tz.js';
import { peekPendingAction } from './pending-actions.js';
import { handleMessage } from './jarvis-orchestrator.js';
import { runRegistryTool } from '../tools/index.js';

/**
 * Перенос встреч и задач — настоящие пути (тест-БД). Раньше «перенеси» создавало
 * вторую встречу, а одну задачу перенести было нечем.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
const KEY = 'FEATURE_V2_SCHEDULE_CONFLICT';
const prev = process.env[KEY];
beforeAll(async () => {
  app = await buildTestApp([eventRoutes, taskRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
afterEach(() => {
  if (prev === undefined) delete process.env[KEY];
  else process.env[KEY] = prev;
});

const TODAY = localDateStr('UTC', new Date());
const D = (n: number) => addCivilDays(TODAY, n);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `mv-${tag}-${Date.now()}@a.test`, name: 'M', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
type Res = { message: string; eventId?: string; taskId?: string };
const run = (tool: { handler: (i: never, c: never) => unknown }, userId: string, input: Record<string, unknown>) =>
  tool.handler(input as never, { userId } as never) as Promise<Res>;

describe('move_event', () => {
  it('переносит ТУ ЖЕ встречу (не создаёт вторую), длительность сохраняется', async () => {
    const { userId } = await user('mv');
    const ev = await prisma.calendarEvent.create({ data: { userId, title: 'Встреча с Сериком', date: day(D(2)), startTime: '14:00', endTime: '15:30' } });
    const r = await run(moveEventTool, userId, { title: 'встреча с сериком', newStartTime: '16:00' });
    expect(r.message).toBe(`Перенёс «Встреча с Сериком» с ${dm(D(2))} в 14:00–15:30 на ${dm(D(2))} в 16:00–17:30.`);
    expect(await prisma.calendarEvent.count({ where: { userId } })).toBe(1);
    expect(await prisma.calendarEvent.findUnique({ where: { id: ev.id } })).toMatchObject({ startTime: '16:00', endTime: '17:30' });
  });

  it('одинаковые («Планёрка» каждую неделю) → ближайшая будущая; «на пятницу» в date = куда', async () => {
    const { userId } = await user('weekly');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(-3)), startTime: '10:00', endTime: '11:00' } });
    const next = await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(1)), startTime: '10:00', endTime: '11:00' } });
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(8)), startTime: '10:00', endTime: '11:00' } });
    const r = await run(moveEventTool, userId, { title: 'Планёрка', date: D(3) });
    expect(r.eventId).toBe(next.id);
    expect(r.message).toContain('(ближайшую)');
    expect((await prisma.calendarEvent.findUnique({ where: { id: next.id } }))?.date.toISOString().slice(0, 10)).toBe(D(3));
  });

  it('после переноса — наложение на задачу нового времени', async () => {
    process.env[KEY] = 'all';
    const { userId } = await user('mvconf');
    await prisma.calendarEvent.create({ data: { userId, title: 'Обед', date: day(D(1)), startTime: '12:00', endTime: '13:00' } });
    await prisma.task.create({ data: { userId, title: 'Созвон', category: 'work', priority: 'medium', date: day(D(1)), time: '15:15' } });
    const r = await run(moveEventTool, userId, { title: 'Обед', newStartTime: '15:00' });
    expect(r.message).toContain('В это же время уже: задача «Созвон» 15:15');
  });

  it('встреча из Google, Google не подключён → честно: «синхронизация вернёт старое время»', async () => {
    const { userId } = await user('g');
    await prisma.calendarEvent.create({ data: { userId, title: 'Звонок', date: day(D(1)), startTime: '09:00', endTime: '09:30', externalId: 'g-123', source: 'google' } });
    const r = await run(moveEventTool, userId, { title: 'Звонок', newStartTime: '11:00' });
    expect(r.message).toContain('В Google Календаре не обновилась');
  });

  it('нет такой встречи / не сказали куда', async () => {
    const { userId } = await user('nf');
    expect((await run(moveEventTool, userId, { title: 'Ахмет', newStartTime: '10:00' })).message).toBe('Не нашёл встречу «Ахмет» в календаре.');
    expect((await run(moveEventTool, userId, { title: 'Ахмет' })).message).toBe('На когда перенести «Ахмет»?');
  });
});

describe('cancel_event — сначала находим, спрашиваем про НЕЁ, удаляем по id на «да»', () => {
  it('вопрос с настоящим названием и временем из базы → «да» → удалена именно она', async () => {
    const { userId } = await user('ca');
    const keep = await prisma.calendarEvent.create({ data: { userId, title: 'Встреча с Сериком', date: day(D(2)), startTime: '14:00' } });
    const target = await prisma.calendarEvent.create({ data: { userId, title: 'Стоматолог', date: day(D(2)), startTime: '18:00' } });
    const r = await run(cancelEventTool, userId, { title: 'стоматолог' });
    expect(r.message).toBe(`Удалить встречу «Стоматолог» ${dm(D(2))} в 18:00? Скажи «да» — удалю.`);
    expect(await prisma.calendarEvent.count({ where: { userId } })).toBe(2); // до «да» ничего не удалено
    expect((await peekPendingAction(userId))?.input).toMatchObject({ eventId: target.id });

    const yes = await handleMessage(userId, 'да');
    expect(yes.reply).toBe(`Удалил встречу «Стоматолог» ${dm(D(2))} в 18:00.`);
    expect(await prisma.calendarEvent.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it('«отмени встречу с Ахметом», есть только с Сериком → НЕ трогаем, честно «не нашёл»', async () => {
    const { userId } = await user('wrong');
    await prisma.calendarEvent.create({ data: { userId, title: 'Встреча с Сериком', date: day(D(1)), startTime: '10:00' } });
    expect((await run(cancelEventTool, userId, { title: 'встреча с Ахметом' })).message).toBe('Не нашёл встречу «встреча с Ахметом» в календаре.');
    expect(await peekPendingAction(userId)).toBeNull();
  });

  it('названа дата, а в неё такой нет → не берём другую', async () => {
    const { userId } = await user('date');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(1)), startTime: '10:00' } });
    expect((await run(cancelEventTool, userId, { title: 'планёрку', date: D(4) })).message).toBe(`На ${dm(D(4))} встречи «планёрку» нет.`);
    expect(await peekPendingAction(userId)).toBeNull();
  });

  it('два разных подходящих → переспросить; чужие не видны', async () => {
    const a = await user('many');
    const b = await user('other');
    await prisma.calendarEvent.create({ data: { userId: a.userId, title: 'Встреча с Ахметом', date: day(D(1)) } });
    await prisma.calendarEvent.create({ data: { userId: a.userId, title: 'Обед с Ахметом', date: day(D(2)) } });
    await prisma.calendarEvent.create({ data: { userId: b.userId, title: 'Чужая встреча', date: day(D(1)) } });
    expect((await run(cancelEventTool, a.userId, { title: 'Ахмет' })).message).toBe('Какую именно: «Встреча с Ахметом», «Обед с Ахметом»?');
    expect((await run(cancelEventTool, a.userId, { title: 'Чужая встреча' })).message).toContain('Не нашёл');
  });
});

describe('move_event — находки ревью', () => {
  it('{date, startTime} как у create_event: в эту дату её нет → это КУДА', async () => {
    const { userId } = await user('cdate');
    const ev = await prisma.calendarEvent.create({ data: { userId, title: 'Встреча с Сериком', date: day(D(1)), startTime: '10:00', endTime: '11:00' } });
    // Через настоящий вход реестра (алиасы startTime→newStartTime), как зовёт мозг.
    await runRegistryTool('move_event', { title: 'Серик', date: D(4), startTime: '16:00' }, { userId });
    expect(await prisma.calendarEvent.findUnique({ where: { id: ev.id } })).toMatchObject({ startTime: '16:00', endTime: '17:00' });
    expect((await prisma.calendarEvent.findUnique({ where: { id: ev.id } }))?.date.toISOString().slice(0, 10)).toBe(D(4));
  });
});

describe('move_task', () => {
  it('одна задача на другой день и время; наложение на встречу', async () => {
    process.env[KEY] = 'all';
    const { userId } = await user('mt');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(1)), startTime: '10:00', endTime: '11:00' } });
    const t = await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'high', date: day(TODAY) } });
    const r = await run(moveTaskTool, userId, { title: 'отчёт', newDate: D(1), newTime: '10:30' });
    expect(r.message).toMatch(new RegExp(`^Перенёс задачу «Отчёт» на ${dm(D(1)).replace('.', '\\.')} в 10:30\\.`));
    expect(r.message).toContain('встреча «Планёрка» 10:00–11:00');
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toMatchObject({ time: '10:30' });
  });
  it('две похожие («Звонок маме», «Звонок в банк») → переспросить, не двигать наугад', async () => {
    const { userId } = await user('mt3');
    await prisma.task.create({ data: { userId, title: 'Звонок маме', category: 'personal', priority: 'low', date: day(TODAY) } });
    await prisma.task.create({ data: { userId, title: 'Звонок в банк', category: 'finance', priority: 'low', date: day(TODAY) } });
    const r = await run(moveTaskTool, userId, { title: 'звонок', newTime: '19:00' });
    expect(r.message).toMatch(/^Какую перенести: «Звонок (маме|в банк)», «Звонок (маме|в банк)»\?$/);
    expect(await prisma.task.count({ where: { userId, time: '19:00' } })).toBe(0);
  });

  it('выполненную не трогаем; "" убирает время', async () => {
    const { userId } = await user('mt2');
    await prisma.task.create({ data: { userId, title: 'Сделано', category: 'work', priority: 'low', date: day(TODAY), completed: true } });
    expect((await run(moveTaskTool, userId, { title: 'Сделано', newDate: D(1) })).message).toContain('Не нашёл');
    const t = await prisma.task.create({ data: { userId, title: 'Звонок маме', category: 'personal', priority: 'low', date: day(TODAY), time: '19:00' } });
    await run(moveTaskTool, userId, { title: 'звонок маме', newTime: '' });
    expect((await prisma.task.findUnique({ where: { id: t.id } }))?.time).toBeNull();
  });
});

describe('экран: PUT/DELETE /events, PUT /tasks', () => {
  it('PUT /events только начало → длительность сохраняется + наложение', async () => {
    process.env[KEY] = 'all';
    const { userId, headers } = await user('put');
    const ev = await prisma.calendarEvent.create({ data: { userId, title: 'Встреча', date: day(D(1)), startTime: '14:00', endTime: '15:00' } });
    await prisma.task.create({ data: { userId, title: 'Почта', category: 'work', priority: 'low', date: day(D(1)), time: '16:30' } });
    const r = await app.inject({ method: 'PUT', url: `/events/${ev.id}`, headers, payload: { startTime: '16:00' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ startTime: '16:00', endTime: '17:00' });
    expect(r.json().conflictWarning).toBe('Накладывается на время с задачей «Почта» в 16:30.');
  });
  it('DELETE /events встречи из Google без подключения → удалена, но честное предупреждение', async () => {
    const { userId, headers } = await user('del');
    const ev = await prisma.calendarEvent.create({ data: { userId, title: 'Из Google', date: day(D(1)), externalId: 'g-9', source: 'google' } });
    const r = await app.inject({ method: 'DELETE', url: `/events/${ev.id}`, headers });
    expect(r.json().warning).toContain('В Google Календаре не удалилась');
    expect(await prisma.calendarEvent.count({ where: { id: ev.id } })).toBe(0);
  });
  it('PUT /tasks новое время поверх встречи → conflictWarning', async () => {
    process.env[KEY] = 'all';
    const { userId, headers } = await user('ptask');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: day(D(1)), startTime: '10:00', endTime: '11:00' } });
    const t = await prisma.task.create({ data: { userId, title: 'Позвонить', category: 'work', priority: 'low', date: day(D(1)) } });
    const r = await app.inject({ method: 'PUT', url: `/tasks/${t.id}`, headers, payload: { time: '10:15' } });
    expect(r.json().conflictWarning).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00.');
  });
});
