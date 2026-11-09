import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { goalRoutes } from './goals.js';

/** Цель накоплений из «Финансов» одним тапом: сумма сразу при создании. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([goalRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('POST /goals/yearly с target', () => {
  it('сумма сохраняется; без неё — как раньше', async () => {
    const u = await prisma.user.create({ data: { email: `gt-${Date.now()}-${Math.random()}@a.test`, name: 'G', passwordHash: 'x', timezone: 'UTC' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const a = await app.inject({ method: 'POST', url: '/goals/yearly', headers, payload: { year: 2026, area: 'finance', goalText: 'Накопить 1 000 000', target: 1000000 } });
    expect(a.statusCode).toBe(201);
    expect(a.json().target).toBe(1000000);
    const b = await app.inject({ method: 'POST', url: '/goals/yearly', headers, payload: { year: 2026, area: 'career', goalText: 'Повышение' } });
    expect(b.json().target).toBeNull();
  });
});

describe('POST /goals/yearly — все 6 областей экрана «Цели»', () => {
  it('«Отношения» и «Творчество» сохраняются (раньше 400)', async () => {
    const u = await prisma.user.create({ data: { email: `ga-${Date.now()}-${Math.random()}@a.test`, name: 'G', passwordHash: 'x', timezone: 'UTC' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    for (const area of ['relationships', 'creativity']) {
      const r = await app.inject({ method: 'POST', url: '/goals/yearly', headers, payload: { year: 2026, area, goalText: 'Цель' } });
      expect(r.statusCode).toBe(201);
    }
  });
});
