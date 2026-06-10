import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeMemory, supersedeByTopic } from './episodic-memory.js';
import { getRelevantMemories } from './memory-service.js';

const prisma = new PrismaClient();
const PREV = process.env.FEATURE_V2_FORGET;
afterAll(async () => {
  if (PREV === undefined) delete process.env.FEATURE_V2_FORGET;
  else process.env.FEATURE_V2_FORGET = PREV;
  await prisma.$disconnect();
});
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `it-supers-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return u.id;
}

describe('F2 — supersedeByTopic invalidates single match', () => {
  it('коррекция инвалидирует старый факт; recall (FORGET) его не отдаёт', async () => {
    process.env.FEATURE_V2_FORGET = 'all';
    const uid = await mkUser(`one-${Date.now()}`);
    const old = await writeMemory(uid, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const neu = await writeMemory(uid, { type: 'preference', content: 'бросил кофе', importance: 6 });
    expect(neu.id).not.toBe(old.id); // разные строки (plainto не сдедупил: «брос» нет в старой)
    const invalidated = await supersedeByTopic(uid, 'preference', 'кофе', neu.id);
    expect(invalidated).toBe(old.id);
    const row = await prisma.memory.findUnique({ where: { id: old.id } });
    expect(row!.invalidAt).not.toBeNull();
    const recall = await getRelevantMemories(uid, 'кофе', 20);
    expect(recall.some((r) => r.id === old.id)).toBe(false);
  });
});

describe('F2 — неоднозначность → скип (не прячем не ту)', () => {
  it('два кофе-факта → null, обе живы', async () => {
    const uid = await mkUser(`amb-${Date.now()}`);
    const a = await writeMemory(uid, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const b = await writeMemory(uid, { type: 'preference', content: 'кофе с молоком вкусный', importance: 6 });
    const neu = await writeMemory(uid, { type: 'preference', content: 'бросил кофе', importance: 6 });
    const invalidated = await supersedeByTopic(uid, 'preference', 'кофе', neu.id);
    expect(invalidated).toBeNull();
    const ra = await prisma.memory.findUnique({ where: { id: a.id } });
    const rb = await prisma.memory.findUnique({ where: { id: b.id } });
    expect(ra!.invalidAt).toBeNull();
    expect(rb!.invalidAt).toBeNull();
  });
});

describe('F2 — cross-user изоляция', () => {
  it('не трогает чужую память', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    await writeMemory(u1, { type: 'preference', content: 'люблю кофе', importance: 6 });
    const out = await supersedeByTopic('someone-else-xyz', 'preference', 'кофе', 'no-id');
    expect(out).toBeNull();
  });
});
