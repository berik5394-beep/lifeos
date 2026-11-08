import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherReflection } from './reflection-context.js';
import { buildV2EnrichmentBlock, fetchV2EnrichmentData } from './v2-enrichment.js';
import { addCivilDays, localDateStr } from '../lib/tz.js';

/**
 * Шаги из «Здоровья» доходят до мозга: POST /steps пишет StepLog → gatherReflection
 * (чат/бриф/нуджи) читает его настоящим запросом. Реальная тест-БД, без vi.mock.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const day = (s: string) => new Date(`${s}T00:00:00Z`);
// 12:00 по Алматы 8 ноября.
const NOW = new Date('2026-11-08T07:00:00Z');

describe('шаги в контексте мозга', () => {
  it('неделя шагов → строка для чата и «вчера» в брифе; старые дни не считаются', async () => {
    const u = await prisma.user.create({
      data: { email: 'steps@brain.test', name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' },
    });
    await prisma.stepLog.createMany({
      data: [
        { userId: u.id, date: day('2026-11-08'), steps: 3200 },
        { userId: u.id, date: day('2026-11-07'), steps: 9000 },
        { userId: u.id, date: day('2026-11-05'), steps: 11000 },
        { userId: u.id, date: day('2026-10-25'), steps: 50000 },
      ],
    });

    const r = await gatherReflection(u.id, NOW);
    expect(r.steps).toBe('Шаги (из «Здоровья»): сегодня пока 3 200, вчера 9 000, в среднем 10 000 в день (2 дн. с данными)');
    expect(r.briefLine).toContain('вчера 9 000 шагов (из «Здоровья»)');
  });

  it('настоящий путь чата: fetchV2EnrichmentData → блок контекста содержит шаги', async () => {
    const u = await prisma.user.create({
      data: { email: 'steps-chat@brain.test', name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' },
    });
    const yesterday = addCivilDays(localDateStr('Asia/Almaty', new Date()), -1);
    await prisma.stepLog.create({ data: { userId: u.id, date: day(yesterday), steps: 7400 } });
    const data = await fetchV2EnrichmentData(u.id);
    expect(data?.steps).toBe('Шаги (из «Здоровья»): вчера 7 400');
    expect(buildV2EnrichmentBlock(data!)).toContain('Шаги (из «Здоровья»): вчера 7 400');
  });

  it('шагов нет → ни строки, ни «0 шагов»', async () => {
    const u = await prisma.user.create({
      data: { email: 'nosteps@brain.test', name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' },
    });
    const r = await gatherReflection(u.id, NOW);
    expect(r.steps).toBeNull();
    expect(r.briefLine ?? '').not.toContain('шаг');
  });
});
