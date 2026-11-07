import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extractTimeOfDayPatterns } from './procedural-memory.js';

/** Привычный час — в поясе юзера (на Railway getHours() = UTC: «обычно в 4:00» вместо 9:00). */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('привычный час привычки', () => {
  it('14 отметок в 04:00 UTC у юзера из Алматы → «обычно в 9:00»', async () => {
    const userId = (
      await prisma.user.create({
        data: { email: `tod-${Date.now()}-${Math.random()}@a.test`, name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' },
      })
    ).id;
    const habit = await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await prisma.memory.createMany({
      data: Array.from({ length: 14 }, (_, i) => ({
        userId,
        type: 'habit_completed',
        content: 'Чтение',
        source: 'manual',
        sourceId: habit.id,
        tags: [],
        validAt: new Date(Date.UTC(2026, 9, 10 + i, 4, 0)),
      })),
    });
    const [p] = await extractTimeOfDayPatterns(userId);
    expect(p.description).toBe('Чтение обычно в 9:00 (±2ч)');
  });
});
