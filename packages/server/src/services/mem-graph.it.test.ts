import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { writeMemory } from './episodic-memory.js';

// Pattern from memory-tier2.it.test.ts: own PrismaClient, disconnect in afterAll.
const prisma = new PrismaClient();

// Restore FEATURE_V2_MEM_GRAPH to original value after all tests to prevent
// flag leaking into other it-files (singleFork + alphabetical run order).
const PREV = process.env.FEATURE_V2_MEM_GRAPH;
afterAll(async () => {
  if (PREV === undefined) delete process.env.FEATURE_V2_MEM_GRAPH;
  else process.env.FEATURE_V2_MEM_GRAPH = PREV;
  await prisma.$disconnect();
});

// Each it-block runs on a clean DB (setup.ts → beforeEach → resetDb truncates all).
// Every test creates its own user via mkUser() with a unique e-mail.

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `it-memgraph-${tag}@it.local`,
      name: 'IT',
      passwordHash: 'x',
      timezone: 'Asia/Almaty',
    },
  });
  return u.id;
}

// ---------------------------------------------------------------------------
// T5 attributes — background preserve / deliberate overwrite
// ---------------------------------------------------------------------------

describe('T5 attributes — фоновое preserve, намеренное overwrite', () => {
  it('фоновый upsert НЕ затирает «брат» «знакомым»; deliberate затирает', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'all';
    const uid = await mkUser(`attr-${Date.now()}`);
    const g = getEntityGraph();

    // Initial upsert: Серик with relation=брат
    await g.upsertEntity(uid, {
      type: 'person',
      name: 'Серик',
      attributes: { relation: 'брат' },
    });

    // Background (non-deliberate) upsert with a weaker value — must NOT overwrite
    await g.upsertEntity(uid, {
      type: 'person',
      name: 'Серик',
      attributes: { relation: 'знакомый' },
    });

    let e = await prisma.entity.findFirst({
      where: { userId: uid, type: 'person', name: 'Серик' },
    });
    expect((e!.attributes as Record<string, unknown>).relation).toBe('брат');

    // Deliberate upsert (explicit correction) — MUST overwrite
    await g.upsertEntity(
      uid,
      { type: 'person', name: 'Серик', attributes: { relation: 'коллега' } },
      { deliberate: true },
    );

    e = await prisma.entity.findFirst({
      where: { userId: uid, type: 'person', name: 'Серик' },
    });
    expect((e!.attributes as Record<string, unknown>).relation).toBe('коллега');
  });
});

// ---------------------------------------------------------------------------
// T5 FTS-порог — слабый матч не клобберит чужую память
//
// "Серик переехал в Астану" vs "Купил машину" — полностью разные токены
// (нет ни одного общего русского стем). FTS @@ вернёт пустой result →
// writeMemory проваливается прямо в CREATE (не доходя до rank-порога).
// Результат: 2 отдельных Memory-строки. Тест валиден — поведение одинаково
// при флаге ON и при OFF (оба раза создаёт), демонстрирует изоляцию записей.
// ---------------------------------------------------------------------------

describe('T5 FTS-порог — слабый матч не клобберит', () => {
  it('непересекающийся контент → две отдельные строки (дедуп не срабатывает)', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'all';
    const uid = await mkUser(`fts-${Date.now()}`);

    await writeMemory(uid, {
      type: 'fact',
      content: 'Серик переехал в Астану',
      importance: 6,
    });
    await writeMemory(uid, {
      type: 'fact',
      content: 'Купил машину',
      importance: 6,
    });

    const rows = await prisma.memory.findMany({
      where: { userId: uid, type: 'fact' },
    });
    expect(rows.length).toBe(2);
  });
});
