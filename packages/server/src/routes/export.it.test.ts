import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { exportRoutes } from './export.js';
import { localDateOnlyUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([exportRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user() {
  return (await prisma.user.create({ data: { email: `ex-${Date.now()}-${Math.random()}@a.test`, name: 'Лейла', passwordHash: 'x', timezone: 'Asia/Almaty' } })).id;
}
const auth = (u: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: u })}` });

// Аудит 2026-11-07: телефон ждал JSON, а сервер отдавал PDF/SVG — «Отчёт» и
// «История» всегда падали; CSV открывался в Excel кракозябрами.
describe('экспорт', () => {
  it('CSV: BOM для Excel и русские подписи категорий', async () => {
    const u = await user();
    await prisma.expense.create({ data: { userId: u, date: new Date(), category: 'food', description: 'обед', amount: 3000 } });
    await prisma.task.create({ data: { userId: u, title: 'отчёт', category: 'work', priority: 'high', date: new Date() } });
    const fin = await app.inject({ method: 'POST', url: '/export/csv/finance', headers: auth(u) });
    expect(fin.statusCode).toBe(200);
    expect(fin.body.startsWith('﻿')).toBe(true);
    expect(fin.body).toContain('Еда');
    expect(fin.body).not.toContain(',food,');
    const tasks = await app.inject({ method: 'POST', url: '/export/csv/tasks', headers: auth(u) });
    expect(tasks.body).toContain('Работа');
    expect(tasks.body).toContain('Высокий');
  });

  it('отчёт: base64 по запросу — это PDF', async () => {
    const u = await user();
    const res = await app.inject({ method: 'POST', url: '/export/pdf/report', headers: auth(u), payload: { period: 'month', format: 'base64' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { filename: string; base64: string };
    expect(body.filename).toMatch(/\.pdf$/);
    expect(Buffer.from(body.base64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('отчёт без format — по-прежнему файл PDF', async () => {
    const u = await user();
    const res = await app.inject({ method: 'POST', url: '/export/pdf/report', headers: auth(u), payload: { period: 'year' } });
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('история: текстом по запросу, без шагов', async () => {
    const u = await user();
    await prisma.task.create({ data: { userId: u, title: 'a', category: 'work', priority: 'low', date: localDateOnlyUTC('Asia/Almaty'), completed: true } });
    const res = await app.inject({ method: 'POST', url: '/export/story', headers: auth(u), payload: { format: 'json' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { title: string; stats: Array<{ label: string; value: string }> };
    expect(body.stats.find((s) => s.label === 'Задачи сегодня')?.value).toBe('1/1');
    expect(body.stats.some((s) => /Шаги/.test(s.label))).toBe(false);
  });
});
