import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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
const KEY = 'FEATURE_V2_SCHEDULE_CONFLICT';
const prev = process.env[KEY];
beforeAll(async () => {
  app = await buildTestApp([quickAddRoutes]);
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
    data: { email: `qa-${tag}-${Date.now()}@a.test`, name: 'Q', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('быстрая строка: наложение по времени', () => {
  it('задача в 10:30 поверх встречи 10:00–11:00 → conflictWarning рядом с task', async () => {
    process.env[KEY] = 'all';
    const { userId, headers } = await user('hit');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date('2026-12-01T00:00:00Z'), startTime: '10:00', endTime: '11:00' } });
    const r = await app.inject({ method: 'POST', url: '/tasks/quick-add', headers, payload: { text: 'позвонить 1 декабря в 10:30' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().task.time).toBe('10:30');
    expect(r.json().conflictWarning).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00.');
  });

  it('без наложения или флаг выкл. → поля нет', async () => {
    process.env[KEY] = 'all';
    const a = await user('free');
    const free = await app.inject({ method: 'POST', url: '/tasks/quick-add', headers: a.headers, payload: { text: 'позвонить' } });
    expect(free.json().conflictWarning).toBeUndefined();

    delete process.env[KEY];
    const b = await user('off');
    await prisma.calendarEvent.create({ data: { userId: b.userId, title: 'Планёрка', date: new Date('2026-12-01T00:00:00Z'), startTime: '10:00', endTime: '11:00' } });
    const off = await app.inject({ method: 'POST', url: '/tasks/quick-add', headers: b.headers, payload: { text: 'позвонить' } });
    expect(off.json().conflictWarning).toBeUndefined();
  });
});
