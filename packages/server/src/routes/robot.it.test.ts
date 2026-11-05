import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';

/**
 * Робот-эпик, Часть 5: робот достал инструмент — объясняет по фактам из БД.
 * Модель замокана: проверяем, что в неё уходят ТОЛЬКО наши факты, что сбой
 * модели даёт ответ из фактов, что история чата не трогается.
 */
const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({
  createAnthropic: () => ({ messages: { create } }),
}));

const { robotRoutes } = await import('./robot.js');
const { gatherPanelFacts } = await import('../services/robot-explain.js');

const prisma = new PrismaClient();
let app: FastifyInstance;
const savedKey = process.env.CLAUDE_API_KEY;

beforeAll(async () => {
  app = await buildTestApp([robotRoutes]);
});
afterAll(async () => {
  process.env.CLAUDE_API_KEY = savedKey;
  await app.close();
  await prisma.$disconnect();
});
beforeEach(() => {
  create.mockReset();
  process.env.CLAUDE_API_KEY = 'test-key-for-mock-0000000000';
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `robot-${tag}-${Date.now()}@a.test`, name: 'Берик Тестов', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const explain = (headers: Record<string, string>, panel: string) =>
  app.inject({ method: 'POST', url: '/robot/explain', headers, payload: { panel } });

const todayUTC = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

describe('/robot/explain — робот объясняет инструмент', () => {
  it('пустой раздел → честное «пока пусто» без вызова модели', async () => {
    const { headers } = await user('empty');
    const res = await explain(headers, 'tasks');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'empty' });
    expect(create).not.toHaveBeenCalled();
  });

  it('факты задач собираются из БД: сегодня, не сделано, просрочено', async () => {
    const { userId } = await user('facts');
    const today = todayUTC();
    const yesterday = new Date(today.getTime() - 86_400_000);
    await prisma.task.createMany({
      data: [
        { userId, title: 'Отчёт', category: 'work', priority: 'high', date: today, time: '14:00' },
        { userId, title: 'Спортзал', category: 'health', priority: 'low', date: today, completed: true },
        { userId, title: 'Старое', category: 'work', priority: 'low', date: yesterday },
      ],
    });
    const facts = await gatherPanelFacts(userId, 'tasks');
    expect(facts.join(' ')).toContain('Задач на сегодня: 2, выполнено 1');
    expect(facts.join(' ')).toContain('14:00 — Отчёт');
    expect(facts.join(' ')).toContain('Просрочено с прошлых дней: 1');
  });

  it('ИИ получает только факты и стиль; ответ ИИ отдаётся; история чата не трогается', async () => {
    const { userId, headers } = await user('ai');
    await prisma.task.create({
      data: { userId, title: 'Позвонить маме', category: 'personal', priority: 'medium', date: todayUTC() },
    });
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Берик, сегодня одна задача — позвонить маме.' }] });
    const res = await explain(headers, 'tasks');
    expect(res.json()).toEqual({ text: 'Берик, сегодня одна задача — позвонить маме.', source: 'ai' });
    const call = create.mock.calls[0][0] as { system: string; messages: Array<{ content: string }> };
    expect(call.system).toContain('ТОЛЬКО ФАКТЫ');
    expect(call.system).toContain('Берик');
    expect(call.messages[0].content).toContain('Позвонить маме');
    expect(await prisma.chatMessage.count({ where: { userId } })).toBe(0);
  });

  it('модель упала → ответ из фактов, робот не молчит', async () => {
    const { userId, headers } = await user('fail');
    await prisma.task.create({
      data: { userId, title: 'Купить хлеб', category: 'home', priority: 'low', date: todayUTC() },
    });
    create.mockRejectedValueOnce(new Error('overloaded'));
    const res = await explain(headers, 'tasks');
    expect(res.json().source).toBe('facts');
    expect(res.json().text).toContain('Купить хлеб');
  });

  it('неизвестный раздел → 400', async () => {
    const { headers } = await user('bad');
    expect((await explain(headers, 'rocket')).statusCode).toBe(400);
  });

  it('факты есть для каждого раздела: финансы, календарь, привычки, цели, дневник, сегодня', async () => {
    const { userId } = await user('all');
    const today = todayUTC();
    const year = today.getUTCFullYear();
    const habit = await prisma.habit.create({ data: { userId, name: 'Вода', category: 'health', frequency: 'daily' } });
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await prisma.habitLog.create({ data: { userId, habitId: habit.id, date: today, completed: true } });
    await prisma.expense.createMany({
      data: [
        { userId, date: today, category: 'food', description: 'обед', amount: 3000 },
        { userId, date: today, category: 'transport', description: 'такси', amount: 1500 },
      ],
    });
    await prisma.calendarEvent.create({ data: { userId, title: 'Встреча с Сериком', date: today, startTime: '10:00' } });
    await prisma.yearlyGoal.create({ data: { userId, year, area: 'finance', goalText: 'Накопить', progress: 40 } });
    await prisma.journalEntry.create({ data: { userId, date: today, mood: 7, energy: 6, sleepHours: 7.5 } });

    const all = async (p: Parameters<typeof gatherPanelFacts>[1]) => (await gatherPanelFacts(userId, p)).join(' ');
    expect(await all('finance')).toContain('Потрачено в этом месяце: 4');
    expect(await all('finance')).toContain('Больше всего — еда');
    expect(await all('calendar')).toContain('сегодня 10:00 — Встреча с Сериком');
    expect(await all('habits')).toContain('Привычек: 2, сегодня отмечено 1');
    expect(await all('habits')).toContain('Чтение');
    expect(await all('goals')).toContain('Накопить — 40%');
    expect(await all('journal')).toContain('настроение 7/10');
    const today_ = await all('today');
    expect(today_).toContain('Встреча с Сериком');
    expect(today_).toContain('Привычки сегодня: 1 из 2');
  });
});
