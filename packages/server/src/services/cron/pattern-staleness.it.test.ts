import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { maybeRetireStale } from './pattern-extraction-cron.js';
import { getProceduralMemory } from '../procedural-memory.singleton.js';

const prisma = new PrismaClient();
const procedural = getProceduralMemory();
afterAll(() => prisma.$disconnect());


const DAY = 86_400_000;
async function mkUser(email: string) {
  const u = await prisma.user.create({
    data: { email, name: 'PS', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return u.id;
}

describe('maybeRetireStale (F4b)', () => {
  it('ретайрит паттерн idle 60+д, свежий не трогает', async () => {
    const u = await mkUser(`ps-on-${Date.now()}@a.test`);
    const stale = await prisma.pattern.create({
      data: { userId: u, kind: 'frequency', description: 'тестовый паттерн', payload: {}, confidence: 0.7, lastObservedAt: new Date(Date.now() - 70 * DAY) },
    });
    const fresh = await prisma.pattern.create({
      data: { userId: u, kind: 'frequency', description: 'тестовый паттерн', payload: {}, confidence: 0.7, lastObservedAt: new Date() },
    });
    const n = await maybeRetireStale(procedural, u);
    expect(n).toBe(1);
    expect((await prisma.pattern.findUnique({ where: { id: stale.id } }))?.invalidAt).not.toBeNull();
    expect((await prisma.pattern.findUnique({ where: { id: fresh.id } }))?.invalidAt).toBeNull();
  });

});
