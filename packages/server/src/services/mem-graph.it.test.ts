import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { writeMemory } from './episodic-memory.js';

// Pattern from memory-tier2.it.test.ts: own PrismaClient, disconnect in afterAll.
const prisma = new PrismaClient();

afterAll(async () => {
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
// Порог 0.08 (флага больше нет — всегда включён): слабый матч отклонён,
// создаётся новая строка → 2 строки. Сильный матч дедупится (memory-tier2).
// ---------------------------------------------------------------------------

describe('T5 FTS-порог — слабый одно-токенный матч', () => {
  const RICH = 'Серик Жумабаев брат познакомились в школе в 2005 году';

  it('порог отклоняет слабый матч → 2 строки', async () => {
    const uid = await mkUser(`fts-on-${Date.now()}`);
    await writeMemory(uid, { type: 'fact', content: RICH, importance: 6 });
    await writeMemory(uid, { type: 'fact', content: 'Серик', importance: 6 });
    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'fact' } });
    expect(rows.length).toBe(2); // порог 0.08 > rank≈0.06 → новая запись
  });
});
