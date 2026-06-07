import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from './postgres-impl.js';

const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
afterAll(() => prisma.$disconnect());

const KEY = 'FEATURE_V2_ENTITY_RESOLVE';
const orig = process.env[KEY];
afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'EC', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('resolveForMerge — real prisma', () => {
  it('Tier2: вариант в алиасах находит сущность', async () => {
    const u = await mkUser(`ec-r2-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', aliases: ['Серый'] } });
    const hit = await graph.resolveForMerge(u, 'Серый', 'person');
    expect(hit?.name).toBe('Серик');
  });
  it('нет совпадения → null', async () => {
    const u = await mkUser(`ec-null-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик' } });
    expect(await graph.resolveForMerge(u, 'Айбек', 'person')).toBeNull();
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser(`ec-iso-a-${Date.now()}@a.test`);
    const b = await mkUser(`ec-iso-b-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Бекзат', aliases: ['Бека'] } });
    expect(await graph.resolveForMerge(b, 'Бека', 'person')).toBeNull();
  });
  it('type-filtered: другой тип не матчит', async () => {
    const u = await mkUser(`ec-type-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'organization', name: 'Каспи', aliases: ['Kaspi'] } });
    expect(await graph.resolveForMerge(u, 'Kaspi', 'person')).toBeNull();
  });
});
