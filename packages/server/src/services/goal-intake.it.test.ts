import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { goalRoutes } from '../routes/goals.js';
import { commitGoal } from './goal-commit.js';
import { setPendingAction, peekPendingAction } from './pending-actions.js';

/**
 * Разбор цели при постановке — настоящие пути (реальная тест-БД, без vi.mock):
 * чат («да» → commitGoal) и экран (POST /goals/yearly → /intake).
 * CLAUDE_API_KEY в тестах нет → строки времени нет (честно, не «2 ч» по умолчанию).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
const KEY = 'FEATURE_V2_GOAL_INTAKE';
const prev = process.env[KEY];
beforeAll(async () => {
  app = await buildTestApp([goalRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
afterEach(() => {
  if (prev === undefined) delete process.env[KEY];
  else process.env[KEY] = prev;
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `intake-${tag}-${Date.now()}@a.test`, name: 'I', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const nb = (s: string) => s.replace(/ /g, ' ');
const YEAR = new Date().getFullYear();

describe('разбор цели — чат (commitGoal)', () => {
  it('денежная цель: «Цель записана» + деньги по записанным доходам/тратам + вопрос', async () => {
    process.env[KEY] = 'all';
    const { userId } = await user('money');
    // 3 мес.: доход 900к, траты 600к → свободно 100к/мес.
    await prisma.income.create({ data: { userId, date: daysAgo(20), source: 'Зарплата', amount: 900_000 } });
    await prisma.expense.create({ data: { userId, date: daysAgo(10), category: 'food', description: 'Еда', amount: 600_000 } });

    const msg = nb(await commitGoal(userId, { area: 'finance', goalText: 'Подушка', target: 5_000_000 }));
    const [head, intake] = msg.split('\n\n');
    expect(head).toMatch(/^Цель записана: «Подушка»/);
    expect(intake).toContain('свободно 100 000 ₸');
    expect(intake).toMatch(/не хватает [\d ]+ ₸ в месяц/);
    expect(intake).toContain('Скажи «да»');
  });

  it('флаг выкл. → ответ как раньше, без разбора', async () => {
    delete process.env[KEY];
    const { userId } = await user('off');
    const msg = await commitGoal(userId, { area: 'finance', goalText: 'Подушка', target: 5_000_000 });
    expect(msg).not.toContain('\n\n');
    expect(msg).toMatch(/Буду вести\.$/);
  });

  it('правка существующей цели — не постановка, разбора нет', async () => {
    process.env[KEY] = 'all';
    const { userId } = await user('upd');
    const g = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'finance', goalText: 'Подушка', target: 1_000_000 } });
    const msg = await commitGoal(userId, { area: 'finance', goalText: 'Подушка', target: 2_000_000, goalId: g.id });
    expect(msg).toMatch(/^Цель обновлена/);
    expect(msg).not.toContain('\n\n');
  });
});

describe('разбор цели — экран (POST /goals/yearly/:id/intake)', () => {
  it('не-денежная: темп + привычка по теме; текст в чате один раз', async () => {
    process.env[KEY] = 'all';
    const { userId, headers } = await user('books');
    await prisma.habit.create({ data: { userId, name: 'Читать 20 минут', category: 'personal', frequency: 'daily' } });
    await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });

    const created = await app.inject({
      method: 'POST',
      url: '/goals/yearly',
      headers,
      payload: { year: YEAR, area: 'spirituality', goalText: 'Прочитать 24 книги', target: 24 },
    });
    expect(created.statusCode).toBe(201);
    const goalId = created.json().id as string;

    const r = await app.inject({ method: 'POST', url: `/goals/yearly/${goalId}/intake`, headers });
    const text = nb(r.json().text as string);
    expect(text.startsWith('Про цель «Прочитать 24 книги»:\n')).toBe(true);
    expect(text).toMatch(/Это ~[\d,]+ в месяц/);
    expect(text).toContain('привычка «Читать 20 минут»');
    expect(text).not.toContain('Зарядка');
    expect(text).not.toContain('По времени'); // нет ИИ-оценки → не выдумываем
    expect(text).toMatch(/Скажи «да»\.$/);

    await app.inject({ method: 'POST', url: `/goals/yearly/${goalId}/intake`, headers });
    const inChat = await prisma.chatMessage.count({ where: { userId, role: 'assistant', content: r.json().text } });
    expect(inChat).toBe(1);
  });

  it('старое неотвеченное предложение снимается: «да» не подтвердит его вслепую', async () => {
    process.env[KEY] = 'all';
    const { userId, headers } = await user('pending');
    await setPendingAction(userId, 'add_expense', { amount: 5000, category: 'food' }, 'Записать расход 5 000 ₸?');
    const g = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Бегать по утрам' } });
    const r = await app.inject({ method: 'POST', url: `/goals/yearly/${g.id}/intake`, headers });
    expect(r.json().text).toBeTruthy();
    expect(await peekPendingAction(userId)).toBeNull();
  });

  it('старая цель (>10 мин) или чужая → null, в чат ничего', async () => {
    process.env[KEY] = 'all';
    const a = await user('old');
    const b = await user('stranger');
    const old = await prisma.yearlyGoal.create({
      data: { userId: a.userId, year: YEAR, area: 'health', goalText: 'Пробежать марафон', createdAt: daysAgo(1) },
    });
    const fresh = await prisma.yearlyGoal.create({ data: { userId: a.userId, year: YEAR, area: 'health', goalText: 'Бег' } });
    expect((await app.inject({ method: 'POST', url: `/goals/yearly/${old.id}/intake`, headers: a.headers })).json().text).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/goals/yearly/${fresh.id}/intake`, headers: b.headers })).json().text).toBeNull();
    expect(await prisma.chatMessage.count({ where: { userId: { in: [a.userId, b.userId] } } })).toBe(0);
  });

  it('флаг выкл. → null', async () => {
    delete process.env[KEY];
    const { userId, headers } = await user('roff');
    const g = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Бег' } });
    expect((await app.inject({ method: 'POST', url: `/goals/yearly/${g.id}/intake`, headers })).json().text).toBeNull();
  });
});
