import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { exportRoutes } from './export.js';
import { seedDemo } from '../../scripts/seed-demo.js';

/** GDPR ст. 20 (2026-11-10): «скачать все мои данные» — всё своё, ничего чужого, без секретов. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([exportRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('POST /export/all', () => {
  it('все разделы пользователя, без паролей/токенов и без чужих данных', async () => {
    const { userId } = await seedDemo(prisma, { email: `exall-${Date.now()}@a.test`, password: 'Long-pass-123' });
    const { userId: other } = await seedDemo(prisma, { email: `exall-o-${Date.now()}@a.test`, password: 'Long-pass-123' });
    await prisma.integration.create({ data: { userId, provider: 'google_calendar', accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH' } });
    const res = await app.inject({ method: 'POST', url: '/export/all', headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/lifeos-all-data-/);
    const body = JSON.parse(res.body);
    expect(body.profile.email).toMatch(/^exall-/);
    for (const m of ['Task', 'Habit', 'HabitLog', 'Expense', 'Income', 'YearlyGoal', 'CalendarEvent', 'JournalEntry', 'StepLog', 'Deal', 'Memory', 'ChatMessage', 'Integration']) {
      expect(body.data[m]?.length ?? 0, m).toBeGreaterThan(0);
    }
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('SECRET-ACCESS');
    expect(res.body).not.toContain('SECRET-REFRESH');
    expect(res.body).not.toContain(other);
  });
});
