import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildRelationshipNudge } from './relationship-link.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
// staleEntities использует РЕАЛЬНОЕ now сервера (не наш now-параметр), поэтому
// сеем lastSeenAt относительно реального времени, заведомо «застоявшимся» (40 дн).
const STALE_AT = new Date(Date.now() - 40 * DAY);

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'RL', passwordHash: 'x' } });
  return u.id;
}

async function seedPerson(userId: string, name: string): Promise<string> {
  const e = await prisma.entity.create({
    data: { userId, type: 'person', name, importance: 6, lastSeenAt: STALE_AT },
  });
  return e.id;
}

describe('relationship-link buildRelationshipNudge — реальная БД', () => {
  it('застоявшийся человек + открытое обязательство → инсайт', async () => {
    const userId = await seedUser('rl-a@a.test');
    const entityId = await seedPerson(userId, 'Серик');
    await prisma.obligation.create({
      data: {
        userId,
        personEntityId: entityId,
        personName: 'Серик',
        direction: 'i_owe',
        kind: 'action',
        description: 'отчёт',
        status: 'open',
        source: 'manual',
      },
    });
    const rn = await buildRelationshipNudge(userId);
    expect(rn).not.toBeNull();
    expect(rn!.personName).toBe('Серик');
    expect(rn!.direction).toBe('i_owe');
    expect(rn!.description).toBe('отчёт');
    expect(rn!.insightText).toContain('Серик');
    expect(rn!.insightText).toContain('отчёт');
  });

  it('застоявшийся человек БЕЗ обязательства → null', async () => {
    const userId = await seedUser('rl-noobl@a.test');
    await seedPerson(userId, 'Айгуль');
    expect(await buildRelationshipNudge(userId)).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('rl-iso-a@a.test');
    const b = await seedUser('rl-iso-b@a.test');
    const entityId = await seedPerson(a, 'Бекзат');
    await prisma.obligation.create({
      data: {
        userId: a, personEntityId: entityId, personName: 'Бекзат', direction: 'i_owe',
        kind: 'action', description: 'долг', status: 'open', source: 'manual',
      },
    });
    expect(await buildRelationshipNudge(b)).toBeNull();
  });
});
