import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { fetchV2EnrichmentData, buildV2EnrichmentBlock } from './v2-enrichment.js';
import { localDayStartUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'SC', passwordHash: 'x', timezone: 'UTC' } });
  return u.id;
}

const TODAY = localDayStartUTC('UTC');

async function seedTask(userId: string, time: string): Promise<void> {
  await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'high', date: TODAY, time, completed: false } });
}
async function seedEvent(userId: string, startTime: string, endTime: string | null): Promise<void> {
  await prisma.calendarEvent.create({ data: { userId, title: 'Серик', date: TODAY, startTime, endTime } });
}

describe('M3 кросс-домен задача↔календарь: конфликт доходит до мозга (end-to-end, тест-БД)', () => {
  beforeEach(() => {
    process.env.FEATURE_V2_SCHEDULE_CONFLICT = 'all';
  });

  it('ДОКАЗАТЕЛЬСТВО: задача 14:00 ∩ встреча 14:00–15:00 → блок содержит ⚠️ Конфликт', async () => {
    const userId = await seedUser(`sc-a-${Date.now()}@a.test`);
    await seedTask(userId, '14:00');
    await seedEvent(userId, '14:00', '15:00');
    const data = await fetchV2EnrichmentData(userId);
    expect(data).not.toBeNull();
    const block = buildV2EnrichmentBlock(data!);
    expect(block).toContain('⚠️ Конфликт');
    expect(block).toContain('Отчёт');
    expect(block).toContain('Серик');
  });

  it('нет пересечения (задача 09:00) → нет конфликта', async () => {
    const userId = await seedUser(`sc-b-${Date.now()}@a.test`);
    await seedTask(userId, '09:00');
    await seedEvent(userId, '14:00', '15:00');
    const block = buildV2EnrichmentBlock((await fetchV2EnrichmentData(userId))!);
    expect(block).not.toContain('⚠️ Конфликт');
  });

  it('флаг OFF → нет конфликта (off=байт-идентично)', async () => {
    const userId = await seedUser(`sc-c-${Date.now()}@a.test`);
    await seedTask(userId, '14:00');
    await seedEvent(userId, '14:00', '15:00');
    process.env.FEATURE_V2_SCHEDULE_CONFLICT = 'none';
    const block = buildV2EnrichmentBlock((await fetchV2EnrichmentData(userId))!);
    expect(block).not.toContain('⚠️ Конфликт');
  });

  it('cross-user: B не видит конфликт A', async () => {
    const a = await seedUser(`sc-d1-${Date.now()}@a.test`);
    const b = await seedUser(`sc-d2-${Date.now()}@a.test`);
    await seedTask(a, '14:00');
    await seedEvent(a, '14:00', '15:00');
    const block = buildV2EnrichmentBlock((await fetchV2EnrichmentData(b))!);
    expect(block).not.toContain('⚠️ Конфликт');
  });
});
