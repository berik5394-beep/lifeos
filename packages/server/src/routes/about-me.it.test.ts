import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { aboutMeRoutes } from './about-me.js';
import { personFacts, dedupeFacts } from '../services/about-me.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([aboutMeRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user() {
  const u = await prisma.user.create({ data: { email: `am-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } });
  return { id: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const mem = (userId: string, type: string, content: string, extra: Record<string, unknown> = {}) =>
  prisma.memory.create({ data: { userId, type, content, source: 'chat', tags: [], ...extra } });

describe('«Что я о тебе помню»', () => {
  it('показывает знания о человеке и людей; журнал действий и сообщения — нет', async () => {
    const u = await user();
    await mem(u.id, 'preference', 'Любит кофе без сахара', { importance: 7 });
    await mem(u.id, 'fact', 'Работает менеджером по продажам');
    await mem(u.id, 'task_created', 'Создал задачу «отчёт»', { source: 'v2-episodic' });
    await mem(u.id, 'message', 'привет');
    const mama = await prisma.entity.create({ data: { userId: u.id, type: 'person', name: 'Мама', importance: 9, attributes: { personType: 'family', birthday: { day: 12, month: 5 } } } });
    const r = (await app.inject({ method: 'GET', url: '/memory/about-me', headers: u.headers })).json();
    expect(r.facts.map((f: { content: string }) => f.content)).toEqual(['Любит кофе без сахара', 'Работает менеджером по продажам']);
    expect(r.people[0]).toMatchObject({ id: mama.id, name: 'Мама', facts: ['семья', 'ДР 12 мая'] });
  });

  it('«Это неправда» → робот забывает (мозг не использует); «Вернуть» → снова помнит; чужое не трогается', async () => {
    const u = await user();
    const other = await user();
    const m = await mem(u.id, 'fact', 'Живёт в Караганде');
    expect((await app.inject({ method: 'POST', url: `/memory/${m.id}/forget`, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/memory/${m.id}/forget`, headers: u.headers })).json()).toEqual({ ok: true });
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: m.id } })).invalidAt).not.toBeNull();
    let r = (await app.inject({ method: 'GET', url: '/memory/about-me', headers: u.headers })).json();
    expect(r.facts).toHaveLength(0);
    await app.inject({ method: 'POST', url: `/memory/${m.id}/restore`, headers: u.headers });
    r = (await app.inject({ method: 'GET', url: '/memory/about-me', headers: u.headers })).json();
    expect(r.facts.map((f: { content: string }) => f.content)).toEqual(['Живёт в Караганде']);
  });
});

describe('форматирование', () => {
  it('факты о человеке по-русски, без контактов и служебного', () => {
    expect(personFacts({ personType: 'client', phone: '+7 777', role: 'брат', _internal: 'x', company: 'Kaspi' })).toEqual(['клиент', 'брат', 'company: Kaspi']);
    expect(personFacts(null)).toEqual([]);
  });
  it('повторы одной фразы — одна строка', () => {
    expect(dedupeFacts([{ content: 'Любит кофе.' }, { content: 'любит  кофе' }, { content: 'Пьёт чай' }]).map((r) => r.content)).toEqual(['Любит кофе.', 'Пьёт чай']);
  });
});
