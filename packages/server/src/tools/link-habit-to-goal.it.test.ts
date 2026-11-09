import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { habitRoutes } from '../routes/habits.js';
import { linkHabitToGoalTool } from './link-habit-to-goal.js';
import { gatherStrategicFacts } from '../services/strategic-view.js';

/**
 * Привязка СУЩЕСТВУЮЩЕЙ привычки к годовой цели — настоящий путь (тест-БД):
 * инструмент мозга + живой читатель (детектор «цель стоит» видит отметки как
 * шаги) + IDOR-фикс REST /habits (чужая цель).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([habitRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const YEAR = new Date().getUTCFullYear();
async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `hlink-${tag}-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
type Res = { message: string; habitId?: string; goalId?: string };
const link = (userId: string, input: Record<string, unknown>) =>
  linkHabitToGoalTool.handler(input as never, { userId } as never) as Promise<Res>;

describe('link_habit_to_goal', () => {
  it('привязал → детектор «цель стоит» считает отметки привычки шагами к цели', async () => {
    const { userId } = await user('link');
    const goal = await prisma.yearlyGoal.create({
      data: { userId, year: YEAR, area: 'health', goalText: 'Пробежать марафон', createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const habit = await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily' } });
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await prisma.habitLog.create({ data: { habitId: habit.id, userId, date: today, completed: true } });

    const before = await gatherStrategicFacts(userId, 'UTC');
    expect(before.goals.find((g) => g.id === goal.id)?.steps).toBe(0);

    const r = await link(userId, { habit: 'бег', goal: 'марафон' });
    expect(r.message).toBe('Привязал «Бег» к цели «Пробежать марафон» — на экране цели видно, сколько дней из 30 ты её делаешь, и скажу, если забросишь.');
    expect((await prisma.habit.findUnique({ where: { id: habit.id } }))?.goalId).toBe(goal.id);

    const after = await gatherStrategicFacts(userId, 'UTC');
    expect(after.goals.find((g) => g.id === goal.id)?.steps).toBe(1);

    expect((await link(userId, { habit: 'Бег', goal: 'Пробежать марафон' })).message).toBe('«Бег» уже привязана к цели «Пробежать марафон».');
  });

  it('перенос на другую цель и отвязка', async () => {
    const { userId } = await user('move');
    const a = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Похудеть на 10 кг' } });
    await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Пробежать марафон' } });
    const habit = await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily', goalId: a.id } });

    expect((await link(userId, { habit: 'Бег', goal: 'марафон' })).message).toContain('(была при «Похудеть на 10 кг»)');
    expect((await link(userId, { habit: 'Бег', unlink: true })).message).toBe('Отвязал «Бег» от цели «Пробежать марафон».');
    expect((await prisma.habit.findUnique({ where: { id: habit.id } }))?.goalId).toBeNull();
    expect((await link(userId, { habit: 'Бег', unlink: true })).message).toContain('и так ни к какой цели не привязана');
  });

  it('не нашёл привычку/цель → честно перечисляет, что есть; чужие цели не видны', async () => {
    const a = await user('nf');
    const b = await user('stranger');
    await prisma.habit.create({ data: { userId: a.userId, name: 'Бег', category: 'health', frequency: 'daily' } });
    await prisma.yearlyGoal.create({ data: { userId: b.userId, year: YEAR, area: 'health', goalText: 'Пробежать марафон' } });

    expect((await link(a.userId, { habit: 'плавание', goal: 'марафон' })).message).toBe('Не нашёл привычку «плавание». Сейчас у тебя: «Бег». Какую привязать?');
    expect((await link(a.userId, { habit: 'Бег', goal: 'марафон' })).message).toBe('Не нашёл цель «марафон» — годовых целей пока нет. Поставить?');
    expect((await link(a.userId, { habit: 'Бег' })).message).toBe('К какой цели привязать «Бег»?');
  });
});

describe('REST /habits — goalId только своей цели (IDOR)', () => {
  it('чужая цель → 404, своя → ок', async () => {
    const a = await user('ra');
    const b = await user('rb');
    const foreign = await prisma.yearlyGoal.create({ data: { userId: b.userId, year: YEAR, area: 'health', goalText: 'Чужая' } });
    const own = await prisma.yearlyGoal.create({ data: { userId: a.userId, year: YEAR, area: 'health', goalText: 'Своя' } });

    const bad = await app.inject({ method: 'POST', url: '/habits', headers: a.headers, payload: { name: 'Бег', category: 'health', frequency: 'daily', goalId: foreign.id } });
    expect(bad.statusCode).toBe(404);
    const ok = await app.inject({ method: 'POST', url: '/habits', headers: a.headers, payload: { name: 'Бег', category: 'health', frequency: 'daily', goalId: own.id } });
    expect(ok.statusCode).toBe(201);

    const id = ok.json().id as string;
    expect((await app.inject({ method: 'PUT', url: `/habits/${id}`, headers: a.headers, payload: { goalId: foreign.id } })).statusCode).toBe(404);
    expect((await prisma.habit.findUnique({ where: { id } }))?.goalId).toBe(own.id);
    expect((await app.inject({ method: 'PUT', url: `/habits/${id}`, headers: a.headers, payload: { goalId: null } })).statusCode).toBe(200);
  });
});
