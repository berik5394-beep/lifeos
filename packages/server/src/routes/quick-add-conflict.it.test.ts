import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { quickAddRoutes } from './quick-add.js';

/**
 * Быстрая строка («позвонить завтра в 10:30») — ГЛАВНЫЙ путь задач со временем
 * с экрана. Подменён только ИИ-разбор фразы (в тестах нет ключа); роут, база,
 * поиск наложения — настоящие. Без этого теста ревью поймало: предупреждение
 * было подключено не к тому пути и не сработало бы ни разу.
 */
const parsed = { title: 'Позвонить', date: '2026-12-01', time: '10:30', category: 'work', priority: 'medium', estimatedMinutes: 15, confidence: 0.9 };
vi.mock('../lib/anthropic.js', () => ({
  createAnthropic: () => ({
    messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(parsed) }] }) },
  }),
}));

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([quickAddRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `qa-${tag}-${Date.now()}@a.test`, name: 'Q', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('быстрая строка: наложение по времени', () => {
  it('задача в 10:30 поверх встречи 10:00–11:00 → conflictWarning рядом с task', async () => {
    const { userId, headers } = await user('hit');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date('2026-12-01T00:00:00Z'), startTime: '10:00', endTime: '11:00' } });
    const r = await app.inject({ method: 'POST', url: '/tasks/quick-add', headers, payload: { text: 'позвонить 1 декабря в 10:30' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().task.time).toBe('10:30');
    expect(r.json().conflictWarning).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00.');
  });

  it('без наложения → поля нет', async () => {
    const a = await user('free');
    const free = await app.inject({ method: 'POST', url: '/tasks/quick-add', headers: a.headers, payload: { text: 'позвонить' } });
    expect(free.json().conflictWarning).toBeUndefined();
  });
});
