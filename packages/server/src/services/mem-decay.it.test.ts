import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { entityDecayScore } from './memory-decay.js';

const prisma = new PrismaClient();

const PREV_DECAY = process.env.FEATURE_V2_DECAY;
afterAll(async () => {
  if (PREV_DECAY === undefined) delete process.env.FEATURE_V2_DECAY;
  else process.env.FEATURE_V2_DECAY = PREV_DECAY;
  await prisma.$disconnect();
});

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `it-decay-${tag}@it.local`,
      name: 'IT',
      passwordHash: 'x',
      timezone: 'Asia/Almaty',
    },
  });
  return u.id;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

// ---------------------------------------------------------------------------
// Part 1 — entity ранг: старая разовая «Камила» тонет ниже мамы
// ---------------------------------------------------------------------------

describe('read-side decay — Part 1 entity ранг', () => {
  it('Камила (старая разовая) тонет ниже мамы по entityDecayScore', async () => {
    const uid = await mkUser(`p1-${Date.now()}`);
    const g = getEntityGraph();

    const mama = await g.upsertEntity(uid, { type: 'person', name: 'Мама', importance: 9 });
    const kamila = await g.upsertEntity(uid, { type: 'person', name: 'Камила', importance: 5 });

    // Мама виделась 40 дней назад, Камила — 180 дней назад
    await prisma.entity.update({ where: { id: mama.id }, data: { lastSeenAt: daysAgo(40) } });
    await prisma.entity.update({ where: { id: kamila.id }, data: { lastSeenAt: daysAgo(180) } });

    const rows = await prisma.entity.findMany({
      where: { userId: uid },
      select: { name: true, importance: true, lastSeenAt: true },
    });

    const now = new Date();
    const ranked = rows
      .map((e) => ({ name: e.name, s: entityDecayScore(e.importance, e.lastSeenAt, now) }))
      .sort((a, b) => b.s - a.s);

    expect(ranked[0].name).toBe('Мама');

    const sMama = ranked.find((r) => r.name === 'Мама')!.s;
    const sKamila = ranked.find((r) => r.name === 'Камила')!.s;
    expect(sKamila).toBeLessThan(sMama);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — recall порядок: свежий fact не ниже старого при флаге on
// ---------------------------------------------------------------------------

describe('read-side decay — Part 2 recall порядок', () => {
  it('свежий fact не ниже старого при флаге on', async () => {
    process.env.FEATURE_V2_DECAY = 'all';

    const { getRelevantMemories } = await import('./memory-service.js');
    const { writeMemory } = await import('./episodic-memory.js');

    const uid = await mkUser(`p2-${Date.now()}`);

    // Старая память (180 дней назад)
    const oldM = await writeMemory(uid, {
      type: 'fact',
      content: 'кофейня на Абая',
      importance: 5,
    });
    await prisma.memory.update({ where: { id: oldM.id }, data: { createdAt: daysAgo(180) } });

    // Проверяем что update прошёл
    const check = await prisma.memory.findUnique({
      where: { id: oldM.id },
      select: { createdAt: true },
    });
    const ageMs = Date.now() - check!.createdAt.getTime();
    expect(ageMs).toBeGreaterThan(170 * 86_400_000); // убеждаемся что 180д обновление прошло

    // Свежая память (только что)
    await writeMemory(uid, {
      type: 'fact',
      content: 'кофейня новая открылась',
      importance: 5,
    });

    const res = await getRelevantMemories(uid, 'кофейня', 10);

    const idxNew = res.findIndex((r) => r.content.includes('новая'));
    const idxOld = res.findIndex((r) => r.content.includes('Абая'));

    expect(idxNew).toBeGreaterThanOrEqual(0); // свежая найдена

    // Детерминированный ассерт (не молчаливый skip): decay сработал, если старая
    // либо вытеснена из выдачи (idxOld < 0), либо строго ниже свежей.
    expect(idxOld < 0 || idxNew < idxOld).toBe(true);

    delete process.env.FEATURE_V2_DECAY;
  });
});
