import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from './entity-graph/postgres-impl.js';
import { entityFacts } from './v2-enrichment.js';

/** Робот обновляет то, что знает о человеке, когда вы прямо говорите «изменилось». */
const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
afterAll(async () => {
  await prisma.$disconnect();
});
const user = async () =>
  (await prisma.user.create({ data: { email: `pac-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x' } })).id;

describe('атрибуты человека из разговора', () => {
  it('«мама переехала в Астану» заменяет Алматы, Алматы — в «раньше»', async () => {
    const u = await user();
    await graph.upsertEntity(u, { type: 'person', name: 'Мама', attributes: { город: 'Алматы' } });
    // обычное упоминание — не затирает
    await graph.upsertEntity(u, { type: 'person', name: 'Мама', attributes: { город: 'Шымкент' } });
    let row = await prisma.entity.findUniqueOrThrow({ where: { userId_type_name: { userId: u, type: 'person', name: 'Мама' } } });
    expect((row.attributes as Record<string, unknown>).город).toBe('Алматы');
    // прямое «переехала»
    await graph.upsertEntity(u, { type: 'person', name: 'Мама', attributes: { город: 'Астана' } }, { changedKeys: ['город'] });
    row = await prisma.entity.findUniqueOrThrow({ where: { id: row.id } });
    const a = row.attributes as Record<string, unknown>;
    expect(a.город).toBe('Астана');
    expect(entityFacts(a)).toBe('город: Астана, раньше город: Алматы');
  });
});
