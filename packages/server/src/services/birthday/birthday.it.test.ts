import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from '../entity-graph/index.js';
import { listPersonBirthdays, buildUpcomingBirthdays } from './index.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  process.env.FEATURE_V2_BIRTHDAY = 'all';
});

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'B', passwordHash: 'x' } });
  return u.id;
}

describe('birthday: запись + чтение (тест-БД)', () => {
  it('upsertEntity пишет birthday в attributes и НЕ затирает прочие ключи', async () => {
    const userId = await seedUser(`bd-a-${Date.now()}@a.test`);
    const graph = getEntityGraph();
    const first = await graph.upsertEntity(userId, {
      type: 'person',
      name: 'Ахмет',
      attributes: { role: 'клиент' } as never,
      importance: 5,
    });
    await graph.upsertEntity(userId, {
      type: 'person',
      name: 'Ахмет',
      attributes: { birthday: { day: 12, month: 5, year: 1994 } } as never,
      importance: 5,
    });
    const ent = await prisma.entity.findUnique({ where: { id: first.id } });
    const attrs = (ent?.attributes ?? {}) as Record<string, unknown>;
    expect(attrs.role).toBe('клиент'); // мерж не затёр
    expect(attrs.birthday).toEqual({ day: 12, month: 5, year: 1994 });

    const rows = await listPersonBirthdays(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ахмет');
  });

  it('buildUpcomingBirthdays ловит ДР в окне и игнорит дальний', async () => {
    const userId = await seedUser(`bd-b-${Date.now()}@a.test`);
    const graph = getEntityGraph();
    const now = new Date('2026-06-05T00:00:00Z');
    await graph.upsertEntity(userId, {
      type: 'person', name: 'Завтрашний',
      attributes: { birthday: { day: 6, month: 6 } } as never, importance: 7,
    });
    await graph.upsertEntity(userId, {
      type: 'person', name: 'Дальний',
      attributes: { birthday: { day: 6, month: 9 } } as never, importance: 7,
    });
    const win1 = await buildUpcomingBirthdays(userId, now, 1);
    expect(win1.map((r) => r.name)).toEqual(['Завтрашний']);
    const win7 = await buildUpcomingBirthdays(userId, now, 7);
    expect(win7.map((r) => r.name)).toEqual(['Завтрашний']); // Дальний (>90д) вне 7
  });

  it('РЕГРЕССИЯ прод: set_birthday через runRegistryTool со СТРОКОВЫМИ day/month пишет ДР', async () => {
    const userId = await seedUser(`bd-reg-${Date.now()}@a.test`);
    const { runRegistryTool } = await import('../../tools/index.js');
    // Ровно то, что прислал LLM в проде: {"day":"25","month":"6","name":...}
    await runRegistryTool('set_birthday', { name: 'Алуа', day: '25', month: '6' }, { userId });
    const rows = await listPersonBirthdays(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Алуа');
    expect(rows[0].birthday).toEqual({ day: 25, month: 6 });
  });

  it('cross-user изоляция: B не видит ДР из A', async () => {
    const a = await seedUser(`bd-c1-${Date.now()}@a.test`);
    const b = await seedUser(`bd-c2-${Date.now()}@a.test`);
    await getEntityGraph().upsertEntity(a, {
      type: 'person', name: 'СекретA',
      attributes: { birthday: { day: 1, month: 1 } } as never, importance: 5,
    });
    expect(await listPersonBirthdays(b)).toHaveLength(0);
  });
});
