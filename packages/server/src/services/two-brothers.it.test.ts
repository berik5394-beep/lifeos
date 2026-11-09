import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from './entity-graph/postgres-impl.js';

/** Два брата без имён — два человека; имя прозвучало — это тот же брат. */
const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
const saved = { r: process.env.FEATURE_V2_ENTITY_RESOLVE };
beforeAll(() => {
  process.env.FEATURE_V2_ENTITY_RESOLVE = 'all'; // как в проде
});
afterAll(async () => {
  process.env.FEATURE_V2_ENTITY_RESOLVE = saved.r;
  await prisma.$disconnect();
});
const user = async () =>
  (await prisma.user.create({ data: { email: `tb-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x' } })).id;
const people = (u: string) => prisma.entity.findMany({ where: { userId: u, type: 'person' }, orderBy: { createdAt: 'asc' } });

describe('два брата', () => {
  it('«старший брат» и «младший брат» — две записи', async () => {
    const u = await user();
    await graph.upsertEntity(u, { type: 'person', name: 'Старший брат', attributes: { город: 'Астана' } });
    await graph.upsertEntity(u, { type: 'person', name: 'Младший брат', attributes: { город: 'Алматы' } });
    const rows = await people(u);
    expect(rows.map((r) => r.name)).toEqual(['Старший брат', 'Младший брат']);
  });

  it('«старшего брата зовут Ерлан» — та же запись получает имя, младший не тронут', async () => {
    const u = await user();
    const elder = await graph.upsertEntity(u, { type: 'person', name: 'Старший брат', attributes: { город: 'Астана' } });
    await graph.upsertEntity(u, { type: 'person', name: 'Младший брат' });
    const named = await graph.upsertEntity(u, { type: 'person', name: 'Ерлан', aliases: ['Старший брат'], attributes: { relation: 'брат' } });
    expect(named.id).toBe(elder.id);
    expect(named.aliases).toContain('Старший брат');
    expect(named.attributes).toMatchObject({ город: 'Астана', relation: 'брат' });
    const rows = await people(u);
    expect(rows.map((r) => r.name).sort()).toEqual(['Ерлан', 'Младший брат']);
  });

  it('обычный алиас (не родство) не переименовывает чужую запись', async () => {
    const u = await user();
    await graph.upsertEntity(u, { type: 'person', name: 'Серик' });
    await graph.upsertEntity(u, { type: 'person', name: 'Сергей', aliases: ['Серик'] });
    // «Серик» — не «только родство»; склейка Серик/Сергей — дело резолвера, не переименования
    const rows = await people(u);
    expect(rows.some((r) => r.name === 'Серик')).toBe(true);
  });
});
