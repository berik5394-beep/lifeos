import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRelevantMemories } from './memory-service.js';

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
