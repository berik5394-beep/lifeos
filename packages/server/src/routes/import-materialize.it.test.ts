import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { importRoutes, materializeImport } from './import.js';

/** Аудит 2026-11-09: выписка — ключи категорий, без дублей при повторе, удаление импорта убирает траты. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([importRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('materializeImport — траты из выписки', () => {
  it('категория → ключ; повтор не задваивает; DELETE /import/:id убирает траты', async () => {
    const u = await prisma.user.create({ data: { email: `imp-${Date.now()}-${Math.random()}@a.test`, name: 'I', passwordHash: 'x', timezone: 'UTC' } });
    const items = [
      { date: '2026-11-05', amount: 12000, category: 'Продукты', description: 'Magnum' },
      { date: '2026-11-06', amount: 4500, category: 'Такси', description: 'Yandex Go' },
    ];
    const f1 = await prisma.importedFile.create({ data: { userId: u.id, fileName: 'kaspi.csv', fileType: 'csv', purpose: 'expenses', parsedData: items } });
    expect((await materializeImport(u.id, 'expenses', items, f1.id)).expenses).toBe(2);
    const f2 = await prisma.importedFile.create({ data: { userId: u.id, fileName: 'kaspi.csv', fileType: 'csv', purpose: 'expenses', parsedData: items } });
    expect((await materializeImport(u.id, 'expenses', items, f2.id)).expenses).toBe(0);

    const rows = await prisma.expense.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => r.category)).toEqual(['food', 'transport']);

    const del = await app.inject({ method: 'DELETE', url: `/import/${f1.id}`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } });
    expect(del.statusCode).toBe(200);
    expect(await prisma.expense.count({ where: { userId: u.id } })).toBe(0);
  });
});
