import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateTaskReminders } from './proactive-notifications.js';
import { localDayStartUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'TR', passwordHash: 'x', timezone: 'UTC' } });
  return u.id;
}

const TODAY = localDayStartUTC('UTC');
const PAST = new Date('2000-01-01T00:00:00Z'); // now в прошлом → thirtyMinBefore всегда > now

describe('generateTaskReminders — закрывает HOLLOW «за 30 мин до задачи» (тест-БД)', () => {
  beforeEach(() => {
    process.env.FEATURE_V2_TASK_REMINDER = 'all';
  });

  it('timed незавершённая задача → нотиф task_reminder_30m за 30 мин', async () => {
    const userId = await seedUser(`tr-a-${Date.now()}@a.test`);
    await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'high', date: TODAY, time: '14:00', completed: false } });
    const ns = await generateTaskReminders(userId, PAST);
    expect(ns).toHaveLength(1);
    expect(ns[0].type).toBe('task_reminder_30m');
    expect(ns[0].body).toContain('Отчёт');
    // scheduledFor = 14:00 UTC сегодня − 30 мин = 13:30
    expect(ns[0].scheduledFor.getUTCHours()).toBe(13);
    expect(ns[0].scheduledFor.getUTCMinutes()).toBe(30);
  });

  it('completed задача → нет нотифа', async () => {
    const userId = await seedUser(`tr-b-${Date.now()}@a.test`);
    await prisma.task.create({ data: { userId, title: 'X', category: 'work', priority: 'low', date: TODAY, time: '14:00', completed: true } });
    expect(await generateTaskReminders(userId, PAST)).toHaveLength(0);
  });

  it('задача без времени → нет нотифа', async () => {
    const userId = await seedUser(`tr-c-${Date.now()}@a.test`);
    await prisma.task.create({ data: { userId, title: 'X', category: 'work', priority: 'low', date: TODAY, time: null, completed: false } });
    expect(await generateTaskReminders(userId, PAST)).toHaveLength(0);
  });

  it('флаг OFF → нет нотифа (off=байт-идентично)', async () => {
    const userId = await seedUser(`tr-d-${Date.now()}@a.test`);
    await prisma.task.create({ data: { userId, title: 'X', category: 'work', priority: 'low', date: TODAY, time: '14:00', completed: false } });
    process.env.FEATURE_V2_TASK_REMINDER = 'none';
    expect(await generateTaskReminders(userId, PAST)).toHaveLength(0);
  });

  it('cross-user: B не видит задачу A', async () => {
    const a = await seedUser(`tr-e1-${Date.now()}@a.test`);
    const b = await seedUser(`tr-e2-${Date.now()}@a.test`);
    await prisma.task.create({ data: { userId: a, title: 'A-task', category: 'work', priority: 'low', date: TODAY, time: '14:00', completed: false } });
    expect(await generateTaskReminders(b, PAST)).toHaveLength(0);
  });
});
