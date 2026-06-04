import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildEnergyLink } from './energy-link.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'EL', passwordHash: 'x' } });
  return u.id;
}

const NOW = new Date(2026, 5, 15);
function daysAgo(n: number): Date {
  const d = new Date(NOW.getTime() - n * 86_400_000);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

describe('energy-link buildEnergyLink — реальная БД', () => {
  it('явный контраст: хороший сон → высокий %, мало сна → низкий → link', async () => {
    const userId = await seedUser('el-a@a.test');
    for (const n of [10, 12, 14, 16]) {
      const date = daysAgo(n);
      await prisma.journalEntry.create({ data: { userId, date, sleepHours: 8 } });
      await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: true } });
      await prisma.task.create({ data: { userId, date, title: 'b', category: 'work', priority: 'low', completed: true } });
    }
    for (const n of [11, 13, 15, 17]) {
      const date = daysAgo(n);
      await prisma.journalEntry.create({ data: { userId, date, sleepHours: 5 } });
      await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: false } });
      await prisma.task.create({ data: { userId, date, title: 'b', category: 'work', priority: 'low', completed: false } });
    }
    const el = await buildEnergyLink(userId, NOW);
    expect(el).not.toBeNull();
    expect(el!.status).toBe('link');
    expect(el!.goodAvg).toBe(100);
    expect(el!.poorAvg).toBe(0);
    expect(el!.gapPct).toBe(100);
    expect(el!.insightText).toContain('продуктивность');
  });

  it('мало данных → null', async () => {
    const userId = await seedUser('el-few@a.test');
    const date = daysAgo(5);
    await prisma.journalEntry.create({ data: { userId, date, sleepHours: 8 } });
    await prisma.task.create({ data: { userId, date, title: 'a', category: 'work', priority: 'low', completed: true } });
    expect(await buildEnergyLink(userId, NOW)).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('el-iso-a@a.test');
    const b = await seedUser('el-iso-b@a.test');
    const date = daysAgo(5);
    await prisma.journalEntry.create({ data: { userId: a, date, sleepHours: 8 } });
    await prisma.task.create({ data: { userId: a, date, title: 'a', category: 'work', priority: 'low', completed: true } });
    expect(await buildEnergyLink(b, NOW)).toBeNull();
  });
});
