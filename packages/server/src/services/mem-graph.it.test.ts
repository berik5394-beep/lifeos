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
// T5 FTS-порог — слабый одно-токенный матч.
//
// Измерено на russian-tsvector: ts_rank(rich-doc, plainto('Серик')) ≈ 0.06,
// что НИЖЕ порога 0.08. Сильный/пере-формулированный матч ≈ 0.26+.
// A/B доказывает, что порог реально МЕНЯЕТ поведение (а не «нет матча»):
//   OFF (без порога) — слабый матч обновляет существующую строку → 1 строка;
//   ON (порог 0.08) — слабый матч отклонён, создаётся новая строка → 2 строки.
// Само-валидируется: если бы @@ не матчил, OFF тоже дал бы 2 → ассерт OFF=1 упал.
// ---------------------------------------------------------------------------

describe('T5 FTS-порог — слабый одно-токенный матч (A/B)', () => {
  const RICH = 'Серик Жумабаев брат познакомились в школе в 2005 году';

  it('OFF: слабый матч дедупит → 1 строка', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'none';
    const uid = await mkUser(`fts-off-${Date.now()}`);
    await writeMemory(uid, { type: 'fact', content: RICH, importance: 6 });
    await writeMemory(uid, { type: 'fact', content: 'Серик', importance: 6 });
    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'fact' } });
    expect(rows.length).toBe(1); // без порога слабый матч обновляет существующую
  });

  it('ON: порог отклоняет слабый матч → 2 строки', async () => {
    process.env.FEATURE_V2_MEM_GRAPH = 'all';
    const uid = await mkUser(`fts-on-${Date.now()}`);
    await writeMemory(uid, { type: 'fact', content: RICH, importance: 6 });
    await writeMemory(uid, { type: 'fact', content: 'Серик', importance: 6 });
    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'fact' } });
    expect(rows.length).toBe(2); // порог 0.08 > rank≈0.06 → новая запись
  });
});
