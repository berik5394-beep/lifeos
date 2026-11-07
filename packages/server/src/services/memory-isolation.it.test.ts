import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from './entity-graph/postgres-impl.js';
import { invalidateEvent } from './episodic-memory.js';

/**
 * Память одного пользователя недоступна другому — даже если в функцию попал
 * чужой id. Три помощника раньше искали по id без владельца.
 */
const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
afterAll(() => prisma.$disconnect());
const user = async () =>
  (await prisma.user.create({ data: { email: `iso-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x' } })).id;

describe('изоляция памяти между пользователями', () => {
  it('getEntity: своё — да, чужое — null', async () => {
    const a = await user();
    const b = await user();
    const mama = await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Мама' } });
    expect((await graph.getEntity(a, mama.id))?.name).toBe('Мама');
    expect(await graph.getEntity(b, mama.id)).toBeNull();
  });

  it('getNeighbors: связи видны владельцу, чужому — пусто', async () => {
    const a = await user();
    const b = await user();
    const me = await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Ерлан' } });
    const sis = await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Дана' } });
    await prisma.entityRelationship.create({ data: { userId: a, fromId: me.id, toId: sis.id, type: 'family' } });
    expect((await graph.getNeighbors(a, me.id, 2)).map((n) => n.entity.name)).toEqual(['Дана']);
    expect(await graph.getNeighbors(b, me.id, 2)).toEqual([]);
  });

  it('invalidateEvent: чужую память не скрыть', async () => {
    const a = await user();
    const b = await user();
    const m = await prisma.memory.create({ data: { userId: a, type: 'fact', content: 'Любит кофе', source: 'chat', tags: [] } });
    expect(await invalidateEvent(b, m.id)).toBe(false);
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: m.id } })).invalidAt).toBeNull();
    expect(await invalidateEvent(a, m.id)).toBe(true);
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: m.id } })).invalidAt).not.toBeNull();
  });
});
