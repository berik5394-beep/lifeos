import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

// Модель замокана: проверяем гард чисел и честную запись из фактов.
const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({ createAnthropic: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }) }));
const { readDiary, factsEntry, hasAnything } = await import('./robot-diary.js');
const { buildTestApp } = await import('../../test/integration/build-test-app.js');
const { aboutMeRoutes } = await import('../routes/about-me.js');

const prisma = new PrismaClient();
let app: FastifyInstance;
const KEY = process.env.CLAUDE_API_KEY;
// 20:00 UTC — вечер: пишутся и вчера, и сегодня.
const NOW = new Date('2026-11-07T20:00:00Z');
const TODAY = new Date('2026-11-07T00:00:00Z');
const YESTERDAY = new Date('2026-11-06T00:00:00Z');

beforeAll(async () => { app = await buildTestApp([aboutMeRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
afterEach(() => {
  create.mockReset();
  if (KEY === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = KEY;
});

async function user() {
  return (await prisma.user.create({ data: { email: `rd-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC' } })).id;
}
const task = (userId: string, date: Date, title: string, completed = true) =>
  prisma.task.create({ data: { userId, title, category: 'work', priority: 'medium', date, completed } });

describe('робот-друг №3: дневник робота', () => {
  it('пустой день — записи нет (не выдумываем)', async () => {
    const u = await user();
    expect(await readDiary(u, NOW)).toEqual([]);
    expect(await prisma.robotDiaryEntry.count({ where: { userId: u } })).toBe(0);
  });

  it('модель пишет по фактам → запись ai; повторное открытие не переписывает', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';
    const u = await user();
    await task(u, YESTERDAY, 'Отчёт');
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Я заметил, что у Берика получилось доделать отчёт. Хороший день.' }] });
    const first = await readDiary(u, NOW);
    expect(first).toEqual([{ day: '2026-11-06', text: 'Я заметил, что у Берика получилось доделать отчёт. Хороший день.' }]);
    expect((await prisma.robotDiaryEntry.findFirstOrThrow({ where: { userId: u } })).source).toBe('ai');
    expect(await readDiary(u, NOW)).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('модель выдумала число → честная запись из фактов', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';
    const u = await user();
    await task(u, YESTERDAY, 'Звонок');
    await task(u, YESTERDAY, 'Счёт');
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Берик закрыл 5 задач и спал 9 часов.' }] });
    const [e] = await readDiary(u, NOW);
    expect(e.text).toBe('За день: 2 задачи закрыты.');
    expect((await prisma.robotDiaryEntry.findFirstOrThrow({ where: { userId: u } })).source).toBe('facts');
  });

  it('вечером пишется и сегодняшний день; днём — только вчера', async () => {
    const u = await user();
    await task(u, YESTERDAY, 'Вчера');
    await task(u, TODAY, 'Сегодня');
    const noon = await readDiary(u, new Date('2026-11-07T12:00:00Z'));
    expect(noon.map((e) => e.day)).toEqual(['2026-11-06']);
    const evening = await readDiary(u, NOW);
    expect(evening.map((e) => e.day)).toEqual(['2026-11-07', '2026-11-06']);
  });

  it('маршрут: только свои записи, без входа — 401', async () => {
    const a = await user();
    const b = await user();
    await prisma.robotDiaryEntry.create({ data: { userId: b, day: YESTERDAY, text: 'чужое' } });
    const r = await app.inject({ method: 'GET', url: '/robot/diary', headers: { authorization: `Bearer ${app.jwt.sign({ sub: a })}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().entries.every((e: { text: string }) => e.text !== 'чужое')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/robot/diary' })).statusCode).toBe(401);
  });
});

describe('честная запись из фактов', () => {
  const base = { day: '2026-11-06', tasksDone: [], tasksOpen: 0, habitsDone: [], journal: null, talkedTimes: 0, remembered: [], events: [] };
  it('склонения и настроение', () => {
    expect(factsEntry({ ...base, tasksDone: ['a'], habitsDone: ['b', 'c', 'd', 'e', 'f'] })).toBe('За день: 1 задача закрыта, 5 привычек отмечено.');
    expect(factsEntry({ ...base, talkedTimes: 2, journal: { sleepHours: null, mood: 3, energy: null, notes: null } })).toContain('непростой');
  });
  it('пустой день распознаётся', () => {
    expect(hasAnything(base)).toBe(false);
    expect(hasAnything({ ...base, talkedTimes: 1 })).toBe(true);
  });
});
