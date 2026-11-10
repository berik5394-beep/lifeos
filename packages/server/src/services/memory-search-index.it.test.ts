import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRelevantMemories } from './memory-service.js';

/**
 * Поиск по памяти робота (2026-11-10): слова записи считает триггер при записи
 * (колонка searchVector), поиск не пересчитывает их на каждый запрос; «живые»
 * записи человека — частичный индекс без служебных message-строк.
 */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

const user = async () =>
  (await prisma.user.create({ data: { email: `msi-${Date.now()}-${Math.random()}@a.test`, name: 'M', passwordHash: 'x' } })).id;
const vec = async (id: string) =>
  (await prisma.$queryRaw<Array<{ v: string | null }>>`SELECT "searchVector"::text AS v FROM "Memory" WHERE id = ${id}`)[0]?.v;

describe('searchVector — слова записи считаются при записи', () => {
  it('вставка заполняет (content + details + tags), правка обновляет', async () => {
    const u = await user();
    const m = await prisma.memory.create({
      data: { userId: u, type: 'fact', content: 'Мама любит пионы', details: 'день рождения в мае', tags: ['семья'], source: 't' },
    });
    const v1 = await vec(m.id);
    expect(v1).toMatch(/пион/);
    expect(v1).toMatch(/рожден/); // из details
    expect(v1).toMatch(/сем/);
    await prisma.memory.update({ where: { id: m.id }, data: { content: 'Мама любит тюльпаны' } });
    const v2 = await vec(m.id);
    expect(v2).toMatch(/тюльпа/);
    expect(v2).not.toMatch(/пион/);
  });

  it('поиск находит по словам из подробностей и тегов', async () => {
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'Спортзал по вторникам', details: 'болела спина после тяги', source: 't' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'Любит кофе без сахара', source: 't' } });
    const found = await getRelevantMemories(u, 'болела спина', 5);
    expect(found[0]?.content).toBe('Спортзал по вторникам');
  });

  it('индексы на месте: GIN по словам, «живые» записи без message, слова content', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE tablename = 'Memory'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining(['Memory_searchVector_idx', 'Memory_userId_live_idx', 'Memory_content_fts_idx']));
  });
});
