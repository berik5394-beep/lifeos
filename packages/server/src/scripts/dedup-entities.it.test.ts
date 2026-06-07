/**
 * S3 backfill — resolve-based (russian FTS) entity dedup, real Prisma.
 *
 * Phase 2 of entity-coreference: finds rows that are the SAME real-world thing
 * under name DECLENSIONS/variants (person "Серик" + person "Сериком" — two rows
 * with EMPTY aliases, accumulated BEFORE the live coreference fix shipped).
 *
 * Matching uses the Postgres russian snowball stemmer (FTS), not JS name-equality
 * — the dup rows have different surface names and empty aliases, so JS overlap
 * finds nothing. Verified: to_tsvector('russian','Сериком') reduces to lexeme
 * 'серик' == to_tsvector('russian','Серик') → Tier1 bare-name match works.
 *
 * Lives outside src/ rootDir (scripts/dedup-entities.ts) → dynamic import of the
 * .js URL (opaque to tsc), same pattern as dedup-entities.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PostgresEntityGraph } from '../services/entity-graph/postgres-impl.js';

const prisma = new PrismaClient();
const graph = new PostgresEntityGraph();
afterAll(() => prisma.$disconnect());

// Script under scripts/ lives outside src/ rootDir → dynamic import of compiled
// .js URL (opaque to tsc, resolved to .ts at runtime by vitest).
type Mode = 'dry-run' | 'apply';
type MergeCounts = { relsRepointed: number; oblsRepointed: number; deleted: number };
type EntityLite = {
  id: string;
  name: string;
  type: string;
  importance: number;
  aliases: string[];
  attributes: Record<string, unknown>;
  createdAt: Date;
};
type DupPair = { canonical: EntityLite; absorbed: EntityLite };
let runS3ResolveBackfill: (
  p: PrismaClient,
  g: PostgresEntityGraph,
  userId: string,
  mode: Mode,
) => Promise<{ pairs: number; merges: number } & MergeCounts>;
let findResolveDupPairs: (
  p: PrismaClient,
  userId: string,
  entities: EntityLite[],
) => Promise<DupPair[]>;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/dedup-entities.js', import.meta.url).href;
  const mod = await import(modulePath);
  runS3ResolveBackfill = mod.runS3ResolveBackfill;
  findResolveDupPairs = mod.findResolveDupPairs;
});

/** Load a user's entities in the EntityLite shape findResolveDupPairs expects. */
async function loadEntities(userId: string): Promise<EntityLite[]> {
  return (await prisma.entity.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      type: true,
      importance: true,
      aliases: true,
      attributes: true,
      createdAt: true,
    },
  })) as unknown as EntityLite[];
}

async function mkUser(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email, name: 'S3', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return u.id;
}

describe('S3 resolve-backfill — apply (Tier1 bare-name russian declension)', () => {
  it('merges person "Сериком" into "Серик", moving relationship + obligation FKs', async () => {
    const userId = await mkUser(`s3-decl-${Date.now()}@a.test`);

    // Two SEPARATE rows, EMPTY aliases — declension dup (pre-fix accumulation).
    const serik = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Серик', importance: 6 },
    });
    const serikom = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Сериком', importance: 5 },
    });

    // A relationship FROM serikom (so we can assert it gets repointed).
    const other = await prisma.entity.create({
      data: { userId, type: 'concept', name: 'Долг', importance: 3 },
    });
    const rel = await prisma.entityRelationship.create({
      data: { userId, fromId: serikom.id, toId: other.id, type: 'connected_to' },
    });

    // An obligation whose person link points at the ABSORBED row — onDelete:SetNull
    // means a naive delete would NULL this = data loss. S3 must repoint it.
    const obl = await prisma.obligation.create({
      data: {
        userId,
        kind: 'money',
        direction: 'owed_to_me',
        personName: 'Сериком',
        personEntityId: serikom.id,
        status: 'open',
        source: 'manual',
        description: 'долг',
      },
    });

    const res = await runS3ResolveBackfill(prisma, graph, userId, 'apply');
    expect(res.merges).toBeGreaterThanOrEqual(1);

    // Exactly ONE person row remains, named "Серик" (importance 6 wins canonical).
    const people = await prisma.entity.findMany({ where: { userId, type: 'person' } });
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Серик');
    expect(people[0].id).toBe(serik.id);
    // Absorbed surface name folded into aliases.
    expect(people[0].aliases).toContain('Сериком');

    // Absorbed row deleted.
    expect(await prisma.entity.findUnique({ where: { id: serikom.id } })).toBeNull();

    // Relationship from-side repointed onto canonical.
    const relAfter = await prisma.entityRelationship.findUnique({ where: { id: rel.id } });
    expect(relAfter?.fromId).toBe(serik.id);

    // Obligation person link repointed onto canonical (NOT nulled).
    const oblAfter = await prisma.obligation.findUnique({ where: { id: obl.id } });
    expect(oblAfter?.personEntityId).toBe(serik.id);
    expect(res.oblsRepointed).toBeGreaterThanOrEqual(1);
  });
});

describe('S3 resolve-backfill — dry-run writes nothing', () => {
  it('finds the pair but leaves both rows + obligation untouched', async () => {
    const userId = await mkUser(`s3-dry-${Date.now()}@a.test`);
    const serik = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Серик', importance: 6 },
    });
    const serikom = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Сериком', importance: 5 },
    });
    const obl = await prisma.obligation.create({
      data: {
        userId,
        kind: 'money',
        direction: 'owed_to_me',
        personName: 'Сериком',
        personEntityId: serikom.id,
        status: 'open',
        source: 'manual',
        description: 'долг',
      },
    });

    const res = await runS3ResolveBackfill(prisma, graph, userId, 'dry-run');
    // Pair detected but no writes.
    expect(res.deleted).toBe(0);
    expect(res.relsRepointed).toBe(0);
    expect(res.oblsRepointed).toBe(0);

    const people = await prisma.entity.findMany({ where: { userId, type: 'person' } });
    expect(people).toHaveLength(2);
    expect(await prisma.entity.findUnique({ where: { id: serik.id } })).not.toBeNull();
    expect(await prisma.entity.findUnique({ where: { id: serikom.id } })).not.toBeNull();
    const oblAfter = await prisma.obligation.findUnique({ where: { id: obl.id } });
    expect(oblAfter?.personEntityId).toBe(serikom.id);
  });
});

describe('S3 resolve-backfill — Tier2 alias match + type isolation', () => {
  it('alias-based variant is absorbed; different type is NOT touched', async () => {
    const userId = await mkUser(`s3-alias-${Date.now()}@a.test`);
    // Canonical already carries the variant in aliases (Tier2 path).
    const aibek = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Айбек', importance: 7, aliases: ['Айбеком'] },
    });
    const aibekom = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Айбеком', importance: 4 },
    });
    // Same surface as a person but DIFFERENT type → must survive (type-filtered).
    const org = await prisma.entity.create({
      data: { userId, type: 'organization', name: 'Айбеком', importance: 2 },
    });

    await runS3ResolveBackfill(prisma, graph, userId, 'apply');

    const people = await prisma.entity.findMany({ where: { userId, type: 'person' } });
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(aibek.id);
    expect(await prisma.entity.findUnique({ where: { id: aibekom.id } })).toBeNull();
    // The organization with the same name is untouched.
    const orgAfter = await prisma.entity.findUnique({ where: { id: org.id } });
    expect(orgAfter).not.toBeNull();
    expect(orgAfter?.type).toBe('organization');
  });
});

describe('findResolveDupPairs — precision (stem-set equality, no over-merge)', () => {
  it('склонение мёржится, родовое⊂специфичного НЕ образует пару', async () => {
    const userId = await mkUser(`s3-prec-${Date.now()}@a.test`);
    // Declension dup → MUST form a pair (стем-множества равны: {серик}={серик}).
    const serik = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Серик', importance: 6 },
    });
    const serikom = await prisma.entity.create({
      data: { userId, type: 'person', name: 'Сериком', importance: 5 },
    });
    // Generic ⊂ specific → MUST NOT form a pair ({бюджет} ≠ {бюджет,остаток}).
    await prisma.entity.create({
      data: { userId, type: 'concept', name: 'Бюджет', importance: 6 },
    });
    await prisma.entity.create({
      data: { userId, type: 'concept', name: 'Остаток бюджета', importance: 5 },
    });

    const pairs = await findResolveDupPairs(prisma, userId, await loadEntities(userId));

    // Exactly the Серик/Сериком pair, nothing else.
    expect(pairs).toHaveLength(1);
    const ids = [pairs[0].canonical.id, pairs[0].absorbed.id].sort();
    expect(ids).toEqual([serik.id, serikom.id].sort());
    // Canonical = higher importance (Серик, imp 6).
    expect(pairs[0].canonical.id).toBe(serik.id);
    expect(pairs[0].absorbed.id).toBe(serikom.id);

    // No Бюджет/Остаток pair anywhere.
    const hasBudgetPair = pairs.some((p) =>
      [p.canonical.name, p.absorbed.name].some((n) => n.includes('бюджет') || n.includes('Бюджет')),
    );
    expect(hasBudgetPair).toBe(false);
  });
});
