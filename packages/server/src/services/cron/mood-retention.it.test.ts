import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runMoodRetention } from './mood-retention-cron.js';

/**
 * Прод 2026-11-07: крон падал каждый день с 23502 (NOT NULL "updatedAt") —
 * raw INSERT не задавал updatedAt, а у колонки в проде нет DB-default
 * (`@updatedAt` — поле уровня Prisma). Воспроизводим прод: снимаем default.
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`ALTER TABLE "MoodSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT`);
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`ALTER TABLE "MoodSnapshot" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$disconnect();
});

describe('runMoodRetention — как в проде (без DB-default у updatedAt)', () => {
  it('сворачивает старые снимки в дневной агрегат и удаляет исходные', async () => {
    const u = await prisma.user.create({
      data: { email: `mr-${Date.now()}-${Math.random()}@a.test`, name: 'MR', passwordHash: 'x', timezone: 'UTC' },
    });
    const old = new Date(Date.now() - 40 * DAY);
    await prisma.moodSnapshot.createMany({
      data: [
        { userId: u.id, source: 'message', valence: -0.2, arousal: 0.4, emotion: 'sad', recordedAt: old },
        { userId: u.id, source: 'message', valence: 0.6, arousal: 0.6, emotion: 'sad', recordedAt: new Date(old.getTime() + 60_000) },
      ],
    });

    await runMoodRetention();

    const rows = await prisma.moodSnapshot.findMany({ where: { userId: u.id } });
    expect(rows.filter((r) => r.source === 'message')).toHaveLength(0);
    const agg = rows.filter((r) => r.source === 'daily_agg');
    expect(agg).toHaveLength(1);
    expect(agg[0].valence).toBeCloseTo(0.2);
    expect(agg[0].emotion).toBe('sad');
  });
});
