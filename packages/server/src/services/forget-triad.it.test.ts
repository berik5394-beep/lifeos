import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRelevantMemories } from './memory-service.js';
import { writeMemory } from './episodic-memory.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const KEY = 'FEATURE_V2_FORGET'; const orig = process.env[KEY];
afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });
async function mkUser(email: string) { const u = await prisma.user.create({ data: { email, name: 'FG', passwordHash: 'x', timezone: 'Asia/Almaty' } }); return u.id; }

describe('getRelevantMemories — F1+F3 forget-gate', () => {
  it('flag ON: message исключён, invalidAt-запись скрыта, активный факт виден', async () => {
    process.env[KEY] = 'all';
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
  it('flag ON: no-query путь тоже исключает message (findMany)', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser(`fg-onnq-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'сырое сообщение', importance: 9, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'настоящий факт', importance: 5, source: 'v2-episodic' } });
    const rows = await getRelevantMemories(u, null, 20);
    expect(rows.some((r) => r.type === 'message')).toBe(false);
    expect(rows.some((r) => r.content.includes('настоящий факт'))).toBe(true);
  });
  it('flag OFF: байт-идентично — message И invalidAt-запись возвращаются', async () => {
    delete process.env[KEY];
    const u = await mkUser(`fg-off-${Date.now()}@a.test`);
    await prisma.memory.create({ data: { userId: u, type: 'message', content: 'сообщение про спорт', importance: 5, source: 'v2-episodic' } });
    await prisma.memory.create({ data: { userId: u, type: 'fact', content: 'инвалид факт про спорт', importance: 5, source: 'v2-episodic', invalidAt: new Date(Date.now() - 1000) } });
    const rows = await getRelevantMemories(u, 'спорт', 20);
    expect(rows.some((r) => r.type === 'message')).toBe(true);
    expect(rows.some((r) => r.content.includes('инвалид факт'))).toBe(true);
  });
});

describe('writeMemory — F5 createdAt forget-gate', () => {
  it('flag ON: дедуп-update НЕ сбрасывает createdAt', async () => {
    process.env[KEY] = 'all';
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
  it('flag OFF: дедуп-update сбрасывает createdAt (как сейчас)', async () => {
    delete process.env[KEY];
    const u = await mkUser(`fg-f5off-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'пью кофе по утрам', importance: 5 });
    const before = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    await new Promise((res) => setTimeout(res, 20));
    const r2 = await writeMemory(u, { type: 'fact', content: 'пью кофе по утрам всегда', importance: 5 });
    expect(r2.action).toBe('updated'); // дедуп реально сработал
    expect(r2.id).toBe(r1.id);
    const after = await prisma.memory.findUnique({ where: { id: r1.id }, select: { createdAt: true } });
    expect(after!.createdAt.getTime()).toBeGreaterThan(before!.createdAt.getTime());
  });
});
