import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { fuzzyMemoryIds, getRelevantMemories } from './memory-service.js';

/** Память по кусочкам букв (2026-11-10): голос исказил имя — робот всё равно вспоминает. */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const user = async () =>
  (await prisma.user.create({ data: { email: `mfz-${Date.now()}-${Math.random()}@a.test`, name: 'M', passwordHash: 'x' } })).id;

describe('память: опечатки и искажения голоса', () => {
  it('«Сирика» находит запись про Серика; посторонние слова — ничего', async () => {
    const u = await user();
    const serik = await prisma.memory.create({ data: { userId: u, type: 'person', content: 'Серик — партнёр по проекту, живёт в Астане', source: 't' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'Любит кофе без сахара', source: 't' } });
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'Серик написал привет', source: 't' } });
    expect(await fuzzyMemoryIds(u, 'что я знаю про Сирика?')).toEqual([serik.id]);
    expect(await fuzzyMemoryIds(u, 'пароль от вайфая')).toEqual([]);
    const found = await getRelevantMemories(u, 'что я знаю про Сирика?', 3);
    expect(found[0]?.content).toMatch(/^Серик/);
  });
  it('длинное слово с опечаткой («инвистор») и чужой пользователь не виден', async () => {
    const u = await user();
    const other = await user();
    const inv = await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'Встреча с инвестором во вторник', source: 't' } });
    await prisma.memory.create({ data: { userId: other, type: 'fact', content: 'Инвестор Тимур', source: 't' } });
    expect(await fuzzyMemoryIds(u, 'когда инвистор?')).toEqual([inv.id]);
  });
  it('забытое («Неправда») не всплывает', async () => {
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'person', content: 'Серик из Алматы', source: 't', invalidAt: new Date(Date.now() - 1000) } });
    expect(await fuzzyMemoryIds(u, 'Сирик')).toEqual([]);
  });
});
