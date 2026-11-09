import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { recordUsage, flushUsage, resetUsageBuffer, usageContext } from '../lib/ai-usage.js';
import { daySummary, retentionOn, buildDailyDigest } from './ai-economics.js';

/**
 * Живой путь: расход копится в памяти → flush в AiUsageDay (повторный flush
 * прибавляет, не затирает) → сводка дня и удержание по UserActiveDay.
 */
describe('экономика и удержание (БД)', () => {
  beforeEach(async () => {
    resetUsageBuffer();
    await prisma.aiUsageDay.deleteMany({});
    await prisma.userActiveDay.deleteMany({});
  });

  it('flush пишет и прибавляет токены на человека и день', async () => {
    const now = new Date('2026-11-09T10:00:00Z');
    usageContext.run({ userId: 'u-econ' }, () => {
      recordUsage({ provider: 'claude', model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 0 }, now);
    });
    await flushUsage();
    usageContext.run({ userId: 'u-econ' }, () => {
      recordUsage({ provider: 'claude', model: 'claude-sonnet-4-6', inputTokens: 1_000_000 }, now);
    });
    recordUsage({ provider: 'claude', model: 'claude-haiku-4-5', inputTokens: 1_000_000 }, now); // фон
    await flushUsage();

    const rows = await prisma.aiUsageDay.findMany({ orderBy: { userId: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === 'u-econ')).toMatchObject({ calls: 2, inputTokens: 2_000_000 });

    await prisma.userActiveDay.create({ data: { userId: 'u-econ', day: new Date('2026-11-09') } });
    const s = await daySummary('2026-11-09');
    expect(s.activeUsers).toBe(1);
    expect(s.totalUsd).toBeCloseTo(6 + 1, 6); // 2M Sonnet-вход + 1M Haiku фоном
    expect(s.perActiveUserUsd).toBeCloseTo(7, 6);
    expect(s.systemUsd).toBeCloseTo(1, 6);
  });

  it('удержание: пришёл вчера, был сегодня → 1 из 1; сводка по-русски', async () => {
    const u = await prisma.user.create({
      data: { email: `econ-${Date.now()}@t.io`, name: 'Э', passwordHash: 'x', createdAt: new Date('2026-11-08T12:00:00Z') },
    });
    await prisma.userActiveDay.createMany({
      data: [
        { userId: u.id, day: new Date('2026-11-08') },
        { userId: u.id, day: new Date('2026-11-09') },
      ],
    });
    expect(await retentionOn('2026-11-09', 1)).toEqual({ cohortDay: '2026-11-08', cohort: 1, returned: 1 });

    const d = await buildDailyDigest(new Date('2026-11-10T04:10:00Z'));
    expect(d.title).toBe('📊 LifeOS за 09.11');
    expect(d.body).toContain('Вернулись: на следующий день 1 из 1');
  });
});
