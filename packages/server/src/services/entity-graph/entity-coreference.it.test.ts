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

describe('upsertEntity resolve-then-merge', () => {
  it('ФЛАГ ON: вариант мёржится в существующую (одна строка + alias)', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`ec-on-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик', aliases: ['Серый'] });
    await graph.upsertEntity(u, { type: 'person', name: 'Серый' }); // нет точного матча → Tier2 → merge
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Серик');
    expect(rows[0].aliases).toContain('Серый');
  });
  it('ФЛАГ ON: разные люди НЕ мёржатся', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`ec-diff-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик' });
    await graph.upsertEntity(u, { type: 'person', name: 'Айбек' });
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' } });
    expect(rows.length).toBe(2);
  });
  it('ФЛАГ OFF: байт-идентично — вариант создаёт ДУБЛЬ, aliases пусты', async () => {
    delete process.env[KEY];
    const u = await mkUser(`ec-off-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'person', name: 'Серик', aliases: ['Серый'] });
    await graph.upsertEntity(u, { type: 'person', name: 'Серый' });
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'person' }, orderBy: { name: 'asc' } });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.aliases.length === 0)).toBe(true);
  });
});

describe('resolveForMerge — precision (stem-set equality, no over-merge)', () => {
  it('склонение со СОВПАДАЮЩИМ стем-множеством → мёржит', async () => {
    const u = await mkUser(`ec-prec-decl-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик' } });
    const hit = await graph.resolveForMerge(u, 'Сериком', 'person');
    expect(hit?.name).toBe('Серик');
  });
  it('родовое ⊂ специфичного (РАЗНЫЕ стем-множества) → НЕ мёржит', async () => {
    const u = await mkUser(`ec-prec-gen-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'concept', name: 'Бюджет' } });
    expect(await graph.resolveForMerge(u, 'Остаток бюджета', 'concept')).toBeNull();
  });
  it('специфичное vs родовое в обе стороны → НЕ мёржит', async () => {
    const u = await mkUser(`ec-prec-mt-${Date.now()}@a.test`);
    await prisma.entity.create({ data: { userId: u, type: 'concept', name: 'Встреча завтра в 15:00' } });
    expect(await graph.resolveForMerge(u, 'Встреча', 'concept')).toBeNull();
  });
  it('upsertEntity ON: Бюджет + Остаток бюджета → ДВЕ строки', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`ec-prec-up-${Date.now()}@a.test`);
    await graph.upsertEntity(u, { type: 'concept', name: 'Бюджет' });
    await graph.upsertEntity(u, { type: 'concept', name: 'Остаток бюджета' });
    const rows = await prisma.entity.findMany({ where: { userId: u, type: 'concept' } });
    expect(rows.length).toBe(2);
  });
});
