import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildDecisionsContext } from './decisions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'D', passwordHash: 'x' } });
  return u.id;
}

describe('buildDecisionsContext — реальная БД', () => {
  it('открытое решение с reviewDate в прошлом → dueForReview', async () => {
    const userId = await seedUser('dec-a@a.test');
    await prisma.decision.create({
      data: { userId, title: 'поставщик A', expectedOutcome: '−15%', reviewDate: new Date('2026-05-01'), decidedAt: new Date('2026-04-01') },
    });
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx).not.toBeNull();
    expect(ctx!.dueForReview).toHaveLength(1);
    expect(ctx!.dueForReview[0].title).toBe('поставщик A');
  });

  it('reviewDate в будущем → не в dueForReview', async () => {
    const userId = await seedUser('dec-b@a.test');
    await prisma.decision.create({
      data: { userId, title: 'будущее', reviewDate: new Date('2026-12-01'), decidedAt: new Date('2026-06-01') },
    });
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx).toBeNull(); // нет due + нет reviewed
  });

  it('reviewed решения → win-rate', async () => {
    const userId = await seedUser('dec-c@a.test');
    for (const v of ['worked', 'worked', 'didnt']) {
      await prisma.decision.create({
        data: { userId, title: `d-${v}`, reviewDate: new Date('2026-05-01'), status: 'reviewed', verdict: v, decidedAt: new Date('2026-04-01') },
      });
    }
    const ctx = await buildDecisionsContext(userId, new Date('2026-06-04'));
    expect(ctx!.winRate).toEqual({ reviewed: 3, worked: 2, rate: 2 / 3 });
  });

  it('изоляция: A не видит решения B', async () => {
    const a = await seedUser('dec-iso-a@a.test');
    const b = await seedUser('dec-iso-b@a.test');
    await prisma.decision.create({
      data: { userId: b, title: 'B-секрет', reviewDate: new Date('2026-05-01'), decidedAt: new Date('2026-04-01') },
    });
    expect(await buildDecisionsContext(a, new Date('2026-06-04'))).toBeNull();
  });
});
