import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { weekNotesRoutes, newlyFilled } from './week-notes.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([weekNotesRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user() {
  const u = await prisma.user.create({ data: { email: `wn-${Date.now()}-${Math.random()}@a.test`, name: 'W', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return { id: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('заметки недели на сервере', () => {
  it('пусто → сохраняет частично → читает; поля, не присланные в PUT, не затираются', async () => {
    const u = await user();
    const empty = await app.inject({ method: 'GET', url: '/week-notes/2026-11-02', headers: u.headers });
    expect(empty.json()).toMatchObject({ notes: '', improve: '', gratitude: '', wins: '' });

    await app.inject({ method: 'PUT', url: '/week-notes/2026-11-02', headers: u.headers, payload: { wins: 'закрыл сделку', improve: 'ложиться до 23' } });
    await app.inject({ method: 'PUT', url: '/week-notes/2026-11-02', headers: u.headers, payload: { gratitude: 'маме' } });

    const got = (await app.inject({ method: 'GET', url: '/week-notes/2026-11-02', headers: u.headers })).json();
    expect(got).toMatchObject({ wins: 'закрыл сделку', improve: 'ложиться до 23', gratitude: 'маме', notes: '' });
  });

  it('чужие заметки не видны; кривая дата → 400', async () => {
    const a = await user();
    const b = await user();
    await app.inject({ method: 'PUT', url: '/week-notes/2026-11-02', headers: a.headers, payload: { notes: 'секрет' } });
    const other = (await app.inject({ method: 'GET', url: '/week-notes/2026-11-02', headers: b.headers })).json();
    expect(other.notes).toBe('');
    const bad = await app.inject({ method: 'GET', url: '/week-notes/2.11.2026', headers: a.headers });
    expect(bad.statusCode).toBe(400);
  });
});

describe('newlyFilled — в память только первая запись поля', () => {
  it('пусто → текст: пишем; правка уже заполненного: не пишем', () => {
    expect(newlyFilled(null, { wins: 'да', notes: '' })).toEqual(['wins']);
    expect(newlyFilled({ wins: 'было' }, { wins: 'стало' })).toEqual([]);
    expect(newlyFilled({ improve: '' }, { improve: '  ' })).toEqual([]);
  });
});
