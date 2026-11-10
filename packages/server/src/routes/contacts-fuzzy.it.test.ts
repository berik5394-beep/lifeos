import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { contactRoutes } from './contacts.js';

/** Поиск контактов (2026-11-10): точного нет — похожие по кусочкам букв. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([contactRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('GET /contacts/search', () => {
  it('«Сирик» находит «Серик Ахметов»; «Азамат» — ничего', async () => {
    const u = (await prisma.user.create({ data: { email: `cf-${Date.now()}@a.test`, name: 'C', passwordHash: 'x' } })).id;
    await prisma.contactCache.createMany({ data: [
      { userId: u, phoneId: '1', name: 'Серик Ахметов', phone: '+7701' },
      { userId: u, phoneId: '2', name: 'Мама', phone: '+7702' },
    ] });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u })}` };
    const r = await app.inject({ method: 'GET', url: `/contacts/search?q=${encodeURIComponent('Сирик')}`, headers });
    expect(r.json().map((c: { name: string }) => c.name)).toEqual(['Серик Ахметов']);
    const n = await app.inject({ method: 'GET', url: `/contacts/search?q=${encodeURIComponent('Азамат')}`, headers });
    expect(n.json()).toEqual([]);
  });
});
