import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRelevantMemories } from './memory-service.js';
import { writeMemory } from './episodic-memory.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function mkUser(email: string) { const u = await prisma.user.create({ data: { email, name: 'FG', passwordHash: 'x', timezone: 'Asia/Almaty' } }); return u.id; }

describe('getRelevantMemories — F1+F3 forget-gate', () => {
  it('message исключён, invalidAt-запись скрыта, активный факт виден', async () => {
    const u = await mkUser(`fg-on-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'привет как дела здоровье', importance: 5, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'старый факт про здоровье', importance: 5, source: 'v2-episodic', invalidAt: new Date(Date.now() - 1000) } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'активный факт про здоровье', importance: 5, source: 'v2-episodic' } });
    const rows = await getRelevantMemories(u, 'здоровье', 20);
    const contents = rows.map((r) => r.content);
    expect(contents.some((c) => c.includes('активный факт'))).toBe(true);
    expect(rows.some((r) => r.type === 'message')).toBe(false);
    expect(contents.some((c) => c.includes('старый факт'))).toBe(false);
  });
  it('no-query путь тоже исключает message (findMany)', async () => {
    const u = await mkUser(`fg-onnq-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'сырое сообщение', importance: 9, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'настоящий факт', importance: 5, source: 'v2-episodic' } });
    const rows = await getRelevantMemories(u, null, 20);
    expect(rows.some((r) => r.type === 'message')).toBe(false);
    expect(rows.some((r) => r.content.includes('настоящий факт'))).toBe(true);
  });

});

describe('writeMemory — F5 createdAt forget-gate', () => {
  it('дедуп-update НЕ сбрасывает createdAt', async () => {
    const u = await mkUser(`fg-f5on-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'люблю бегать по утрам', importance: 5 });
    const before = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    await new Promise((res) => setTimeout(res, 20));
    // субсет-лексемы (любл & бега & утр) → русский FTS дедуп попадает в r1
    const r2 = await writeMemory(u, { type: 'fact', content: 'люблю бегать утром', importance: 5 });
    expect(r2.action).toBe('updated'); // дедуп реально сработал (строка переиспользована)
    expect(r2.id).toBe(r1.id);
    const cnt = await prisma.memory.count({ where: { userId: u, type: 'fact' } });
    expect(cnt).toBe(1); // ни одной новой строки — апдейт, не вставка
    const after = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    expect(after?.createdAt.getTime()).toBe(before?.createdAt.getTime());
  });

});
