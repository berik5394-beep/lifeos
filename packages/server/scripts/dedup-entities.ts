/**
 * v2 Phase A polish — Entity coreference resolution (Q4, 2026-05-31).
 *
 * Single-user dedup script. Two strategies:
 *
 *   S1: Same-name across types
 *       e.g. concept="Работа" + goal="Работа"
 *       → keep highest-importance, push other's type into attributes.alias_types[]
 *
 *   S2: Relation-based person coreference
 *       e.g. person="Роза" {attributes.relation: "мама"} + person="Мама"
 *       → merge "Мама" into "Роза" (canonical proper name wins,
 *         relation-name added to aliases[])
 *
 * Mechanics of safe merge:
 *   1. Pick canonical: highest importance, oldest createdAt tie-break
 *   2. Repoint ALL EntityRelationship.fromId/toId pointing at duplicates
 *      → point at canonical (best-effort; relationships involving deleted
 *      entities cannot be unique-violated because (userId, fromId, toId, type)
 *      is not enforced unique — manual dedupe just deletes literal dupes
 *      after repoint).
 *   3. Union aliases[] (canonical.aliases ++ each dup.name + each dup.aliases)
 *   4. Union attributes (canonical wins on key conflict)
 *   5. Delete dupes
 *
 * NEVER throws — per-step try/catch, partial faults logged.
 *
 * Usage:
 *   npx tsx packages/server/scripts/dedup-entities.ts --user=<id> --dry-run
 *   npx tsx packages/server/scripts/dedup-entities.ts --user=<id> --apply
 */

import { PrismaClient, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Pure CLI parser (mirrors migrate-to-v2 shape)
// ---------------------------------------------------------------------------

export type CliArgs =
  | { userId: string; mode: 'dry-run' | 'apply' }
  | { error: string };

export function parseCliArgs(argv: string[]): CliArgs {
  let userId: string | undefined;
  let dryRun = false;
  let apply = false;
  for (const arg of argv) {
    if (arg.startsWith('--user=')) {
      const val = arg.slice('--user='.length).trim();
      if (val.length === 0) {
        return { error: '--user=<id> requires a non-empty value' };
      }
      userId = val;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--apply') {
      apply = true;
    }
  }
  if (!userId) {
    return { error: 'Missing --user=<id>. Usage: --user=<id> --dry-run | --apply' };
  }
  if (dryRun && apply) {
    return { error: '--dry-run and --apply are mutually exclusive' };
  }
  if (!dryRun && !apply) {
    return { error: 'Pick a mode: --dry-run or --apply' };
  }
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityLite = {
  id: string;
  name: string;
  type: string;
  importance: number;
  aliases: string[];
  attributes: Record<string, unknown>;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Cross-language relation aliases. Claude extractor returns these in mixed
 * EN/RU (e.g. Роза.attrs.relation="mother", Дана.attrs.relation="сестра").
 * Canonical key = Russian form. Lookup is by lowercase exact match —
 * inflections not handled (we'd need a stemmer for that, overkill).
 *
 * Used by S2 to match person.attrs.relation against another person's
 * name across languages.
 */
export const RELATION_ALIASES: Record<string, string[]> = {
  'мама':   ['мама', 'мать', 'mother', 'мам', 'мамочка', 'мамуля'],
  'папа':   ['папа', 'отец', 'father', 'батя', 'папочка'],
  'сестра': ['сестра', 'сестрёнка', 'sister', 'сестрица'],
  'брат':   ['брат', 'братишка', 'brother', 'братец'],
  'жена':   ['жена', 'супруга', 'wife'],
  'муж':    ['муж', 'супруг', 'husband'],
  'сын':    ['сын', 'сынок', 'son'],
  'дочь':   ['дочь', 'дочка', 'daughter'],
  'друг':   ['друг', 'приятель', 'friend', 'кореш'],
};

/**
 * Map a relation-or-name token to canonical Russian form, or null if
 * not in the alias table. Allows Роза(relation=mother) ↔ Мама to match.
 */
export function canonicalizeRelation(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const k = normalizeKey(raw);
  for (const [canon, aliases] of Object.entries(RELATION_ALIASES)) {
    if (aliases.includes(k)) return canon;
  }
  return null;
}

/**
 * S1: group entities by (normalized name). Returns groups of size >= 2
 * spanning multiple types.
 */
export function findSameNameAcrossTypes(
  entities: EntityLite[],
): Array<{ name: string; members: EntityLite[] }> {
  const byKey = new Map<string, EntityLite[]>();
  for (const e of entities) {
    const k = normalizeKey(e.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(e);
  }
  const groups: Array<{ name: string; members: EntityLite[] }> = [];
  for (const [, members] of byKey) {
    if (members.length < 2) continue;
    const types = new Set(members.map((m) => m.type));
    // S1 specifically targets cross-type duplicates. Same-type dupes are
    // physically prevented by the (userId, type, name) unique constraint
    // — except via aliases — so this filter is mostly a safety belt.
    if (types.size < 2) continue;
    groups.push({ name: members[0].name, members });
  }
  return groups;
}

/**
 * S2: find pairs where entity A (person) has `attributes.relation`
 * matching entity B's (person) name. Returns merges (canonical = A,
 * absorbed = B).
 */
export function findRelationBasedPairs(
  entities: EntityLite[],
): Array<{ canonical: EntityLite; absorbed: EntityLite }> {
  const people = entities.filter((e) => e.type === 'person');

  // Index persons by canonical relation form (mother/папа/sister/...) AND by
  // raw lowercased name — so Роза(relation="mother") can match an entity
  // named "Мама", "мать", or even literal "mother".
  const byCanonRelation = new Map<string, EntityLite>();
  const byRawName = new Map<string, EntityLite>();
  for (const p of people) {
    const rawKey = normalizeKey(p.name);
    byRawName.set(rawKey, p);
    const canon = canonicalizeRelation(p.name);
    if (canon) byCanonRelation.set(canon, p);
  }

  const pairs: Array<{ canonical: EntityLite; absorbed: EntityLite }> = [];
  const seen = new Set<string>();
  for (const a of people) {
    const relRaw = (a.attributes ?? {}).relation;
    if (typeof relRaw !== 'string' || !relRaw.trim()) continue;
    if (normalizeKey(relRaw) === normalizeKey(a.name)) continue; // self-relation
    const canonRel = canonicalizeRelation(relRaw);
    // Try canonical alias map first (mother → мама → person named Мама),
    // then fall back to literal raw-name match (preserves old behavior).
    let b: EntityLite | undefined;
    if (canonRel) {
      b = byCanonRelation.get(canonRel);
    }
    if (!b || b.id === a.id) {
      b = byRawName.get(normalizeKey(relRaw));
    }
    if (!b || b.id === a.id) continue;
    // Avoid both directions: process each unordered pair once.
    const pairKey = [a.id, b.id].sort().join('|');
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    // Canonical = the one with the proper name; the relation-named one
    // is absorbed. Heuristic: a's name is the proper one because a stored
    // the relation attribute pointing at b.
    pairs.push({ canonical: a, absorbed: b });
  }
  return pairs;
}

export function pickCanonical(group: EntityLite[]): EntityLite {
  return [...group].sort((x, y) => {
    if (y.importance !== x.importance) return y.importance - x.importance;
    return x.createdAt.getTime() - y.createdAt.getTime();
  })[0];
}

export function mergeAttributes(
  canonical: Record<string, unknown>,
  others: Record<string, unknown>[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...canonical };
  for (const o of others) {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (!(k in merged)) merged[k] = v;
    }
  }
  return merged;
}

export function mergeAliases(
  canonicalAliases: string[],
  absorbed: EntityLite[],
): string[] {
  const set = new Set<string>(canonicalAliases ?? []);
  for (const a of absorbed) {
    if (a.name) set.add(a.name);
    for (const al of a.aliases ?? []) set.add(al);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// S3: resolve-based dedup (russian FTS) — declension/variant rows
// ---------------------------------------------------------------------------
//
// Why FTS, not JS name-equality: the dup rows have DIFFERENT surface names
// ("Серик" vs "Сериком") and EMPTY aliases (accumulated before the live
// coreference fix shipped). JS name-overlap (S1/S2) finds nothing here. The
// Postgres russian snowball stemmer reduces "Сериком" → lexeme 'серик' ==
// "Серик", so FTS matches the pair.
//
// Mirrors resolveForMerge in postgres-impl.ts: Tier1 name FTS, Tier2 alias FTS,
// type-filtered, russian. ADDS `AND e.id <> $excludeId` (exclude self). NO
// embedding tier — conservative, name+alias only.

/**
 * Minimal shape of PrismaClient used by S3 — `$queryRawUnsafe` + the three
 * write paths. Typed structurally so the script stays decoupled from the
 * generated client surface and avoids `any`.
 */
export type S3Prisma = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  entityRelationship: {
    updateMany(args: {
      where: { userId: string; fromId?: string; toId?: string };
      data: { fromId?: string; toId?: string };
    }): Promise<{ count: number }>;
  };
  obligation: {
    updateMany(args: {
      where: { userId: string; personEntityId: string };
      data: { personEntityId: string };
    }): Promise<{ count: number }>;
  };
  entity: {
    update(args: {
      where: { id: string };
      data: { aliases: string[]; attributes: Prisma.InputJsonValue };
    }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
};

/** Single FTS hit (subset of Entity columns, no embedding). */
type FtsHit = { id: string };

/**
 * For each entity, run a russian-FTS query (Tier1 name + Tier2 alias,
 * type-filtered, exclude self) to find ONE candidate match among the user's
 * other entities. Returns deduped, directed pairs (canonical via pickCanonical).
 *
 * Skips a side if it is already absorbed by an earlier pair (an entity can be a
 * canonical OR an absorbed, never both — keeps the merge graph a simple forest).
 */
export async function findResolveDupPairs(
  prisma: S3Prisma,
  userId: string,
  entities: EntityLite[],
): Promise<Array<{ canonical: EntityLite; absorbed: EntityLite }>> {
  const byId = new Map<string, EntityLite>(entities.map((e) => [e.id, e]));
  const pairs: Array<{ canonical: EntityLite; absorbed: EntityLite }> = [];
  const seenPair = new Set<string>();
  const claimed = new Set<string>(); // ids already on either side of a pair

  for (const self of entities) {
    if (claimed.has(self.id)) continue;
    const hit = await resolveDupCandidate(prisma, userId, self);
    if (!hit) continue;
    const other = byId.get(hit.id);
    if (!other || other.id === self.id) continue;
    if (claimed.has(other.id)) continue;

    const pairKey = [self.id, other.id].sort().join('|');
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);

    const canonical = pickCanonical([self, other]);
    const absorbed = canonical.id === self.id ? other : self;
    pairs.push({ canonical, absorbed });
    claimed.add(canonical.id);
    claimed.add(absorbed.id);
  }
  return pairs;
}

/**
 * Tier1 (name FTS) then Tier2 (alias FTS) candidate lookup for one entity.
 * type-filtered + `e.id <> self`. Russian stemmer. Best-effort → null on error.
 * Mirrors resolveForMerge's tiers minus the embedding tier.
 */
async function resolveDupCandidate(
  prisma: S3Prisma,
  userId: string,
  self: EntityLite,
): Promise<FtsHit | null> {
  const mention = (self.name ?? '').trim().slice(0, 255);
  if (!mention) return null;
  const tf = `AND e.type = '${self.type.replace(/'/g, "''")}'`;
  const nv = `to_tsvector('russian', e.name)`;
  const nq = `plainto_tsquery('russian', $2)`;
  try {
    const t1 = await prisma.$queryRawUnsafe<FtsHit[]>(
      `SELECT e.id FROM "Entity" e
       WHERE e."userId" = $1 AND e.id <> $3 AND ${nv} @@ ${nq} ${tf}
       ORDER BY ts_rank(${nv}, ${nq}) DESC LIMIT 1`,
      userId,
      mention,
      self.id,
    );
    if (t1.length > 0) return t1[0];
    const t2 = await prisma.$queryRawUnsafe<FtsHit[]>(
      `SELECT DISTINCT e.id FROM "Entity" e, unnest(e.aliases) av
       WHERE e."userId" = $1 AND e.id <> $3 AND to_tsvector('russian', av) @@ ${nq} ${tf}
       ORDER BY e.id LIMIT 1`,
      userId,
      mention,
      self.id,
    );
    if (t2.length > 0) return t2[0];
    return null;
  } catch (err) {
    console.warn(
      '[dedup-entities] S3 resolveDupCandidate failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Apply (or, in dry-run, just plan) one S3 merge: move BOTH foreign keys off the
 * absorbed row, fold its aliases+attributes into canonical, delete it.
 *
 * CRITICAL vs S1/S2: those only repoint EntityRelationship. Obligation has
 * `personEntityId onDelete: SetNull`, so deleting an absorbed entity would NULL
 * its obligations' person link = DATA LOSS. S3 repoints obligations too.
 *
 * dry-run: writes nothing, returns zero counts (caller logs the intended merge).
 */
export async function mergeEntityPair(
  prisma: S3Prisma,
  userId: string,
  canonical: EntityLite,
  absorbed: EntityLite,
  mode: 'dry-run' | 'apply',
): Promise<{ relsRepointed: number; oblsRepointed: number; deleted: number }> {
  if (mode !== 'apply') {
    return { relsRepointed: 0, oblsRepointed: 0, deleted: 0 };
  }
  // 1. Repoint EntityRelationship (both directions) absorbed → canonical.
  const r1 = await prisma.entityRelationship.updateMany({
    where: { userId, fromId: absorbed.id },
    data: { fromId: canonical.id },
  });
  const r2 = await prisma.entityRelationship.updateMany({
    where: { userId, toId: absorbed.id },
    data: { toId: canonical.id },
  });
  // 2. Repoint Obligation.personEntityId absorbed → canonical (avoid SetNull loss).
  const ro = await prisma.obligation.updateMany({
    where: { userId, personEntityId: absorbed.id },
    data: { personEntityId: canonical.id },
  });
  // 3. Fold aliases + attributes into canonical.
  const mergedAliases = mergeAliases(canonical.aliases ?? [], [absorbed]);
  const mergedAttrs = mergeAttributes(canonical.attributes, [absorbed.attributes]);
  await prisma.entity.update({
    where: { id: canonical.id },
    data: { aliases: mergedAliases, attributes: mergedAttrs as Prisma.InputJsonValue },
  });
  // 4. Delete absorbed.
  await prisma.entity.delete({ where: { id: absorbed.id } });

  return {
    relsRepointed: r1.count + r2.count,
    oblsRepointed: ro.count,
    deleted: 1,
  };
}

/**
 * S3 entrypoint — find resolve-based dup pairs, log each, merge them.
 * Exported so tests (and main()) can drive it directly without argv. `graph` is
 * accepted for parity with the live coreference path but S3 uses raw FTS via
 * `prisma` (kept in the signature so callers needn't construct one conditionally).
 */
export async function runS3ResolveBackfill(
  prisma: S3Prisma,
  _graph: unknown,
  userId: string,
  mode: 'dry-run' | 'apply',
  entities?: EntityLite[],
): Promise<{
  pairs: number;
  merges: number;
  relsRepointed: number;
  oblsRepointed: number;
  deleted: number;
}> {
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  const rows =
    entities ??
    ((await (prisma as unknown as { entity: { findMany: (a: unknown) => Promise<unknown> } }).entity.findMany(
      {
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
      },
    )) as unknown as EntityLite[]);

  const pairs = await findResolveDupPairs(prisma, userId, rows);
  console.log(`${tag} S3 (resolve-based FTS dedup): ${pairs.length} pair(s)`);

  let merges = 0;
  let relsRepointed = 0;
  let oblsRepointed = 0;
  let deleted = 0;
  for (const { canonical, absorbed } of pairs) {
    try {
      console.log(
        `${tag} S3: canonical="${canonical.name}" imp=${canonical.importance} ` +
          `absorbs "${absorbed.name}" (id=${absorbed.id.slice(0, 8)})`,
      );
      const c = await mergeEntityPair(prisma, userId, canonical, absorbed, mode);
      relsRepointed += c.relsRepointed;
      oblsRepointed += c.oblsRepointed;
      deleted += c.deleted;
      merges++;
    } catch (err) {
      console.warn(
        `${tag} S3: merge ${canonical.name} ← ${absorbed.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { pairs: pairs.length, merges, relsRepointed, oblsRepointed, deleted };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('dedup-entities:', parsed.error);
    console.error(
      'Usage:\n' +
        '  npx tsx packages/server/scripts/dedup-entities.ts --user=<id> --dry-run\n' +
        '  npx tsx packages/server/scripts/dedup-entities.ts --user=<id> --apply',
    );
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  console.log(`[dedup-entities] user=${userId} mode=${mode}`);

  let s1Merges = 0;
  let s2Merges = 0;
  let s3Merges = 0;
  let s1Skipped = 0;
  let s2Skipped = 0;
  let relsRepointed = 0;
  let oblsRepointed = 0;
  let entitiesDeleted = 0;

  try {
    const rows = (await prisma.entity.findMany({
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

    console.log(`${tag} loaded ${rows.length} entities`);

    // ---------- Strategy 1: same-name cross-type ---------------------------
    const s1Groups = findSameNameAcrossTypes(rows);
    console.log(`${tag} S1 (cross-type same-name): ${s1Groups.length} group(s)`);
    for (const g of s1Groups) {
      try {
        const canonical = pickCanonical(g.members);
        const absorbed = g.members.filter((e) => e.id !== canonical.id);
        const aliasTypes = [
          ...new Set([
            ...(((canonical.attributes ?? {}).alias_types as string[]) ?? []),
            ...absorbed.map((a) => a.type),
          ]),
        ];
        const mergedAttrs = mergeAttributes(
          canonical.attributes,
          absorbed.map((a) => a.attributes),
        );
        mergedAttrs.alias_types = aliasTypes;
        const mergedAliases = mergeAliases(canonical.aliases ?? [], absorbed);

        console.log(
          `${tag} S1: "${canonical.name}" canonical=${canonical.type} imp=${canonical.importance} ` +
            `absorbs [${absorbed.map((a) => `${a.type}:${a.id.slice(0, 8)}`).join(', ')}]`,
        );

        if (mode === 'apply') {
          // Repoint relationships
          for (const a of absorbed) {
            const repoint1 = await prisma.entityRelationship.updateMany({
              where: { userId, fromId: a.id },
              data: { fromId: canonical.id },
            });
            const repoint2 = await prisma.entityRelationship.updateMany({
              where: { userId, toId: a.id },
              data: { toId: canonical.id },
            });
            relsRepointed += repoint1.count + repoint2.count;
          }
          // Update canonical
          await prisma.entity.update({
            where: { id: canonical.id },
            data: {
              aliases: mergedAliases,
              attributes: mergedAttrs as Prisma.InputJsonValue,
            },
          });
          // Delete absorbed
          for (const a of absorbed) {
            await prisma.entity.delete({ where: { id: a.id } });
            entitiesDeleted++;
          }
        }
        s1Merges++;
      } catch (err) {
        s1Skipped++;
        console.warn(`${tag} S1: merge "${g.name}" failed:`, err);
      }
    }

    // ---------- Strategy 2: relation-based person coreference --------------
    // Re-fetch entities only if we modified data (apply), else operate on
    // already-loaded rows. In dry-run mode rows is still valid; in apply
    // we want the post-S1 state.
    const postS1 =
      mode === 'apply'
        ? ((await prisma.entity.findMany({
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
          })) as unknown as EntityLite[])
        : rows;

    const s2Pairs = findRelationBasedPairs(postS1);
    console.log(`${tag} S2 (relation-based person coreference): ${s2Pairs.length} pair(s)`);
    for (const { canonical, absorbed } of s2Pairs) {
      try {
        const mergedAttrs = mergeAttributes(canonical.attributes, [absorbed.attributes]);
        const mergedAliases = mergeAliases(canonical.aliases ?? [], [absorbed]);
        console.log(
          `${tag} S2: canonical="${canonical.name}" (rel=${canonical.attributes.relation}) ` +
            `absorbs "${absorbed.name}" (id=${absorbed.id.slice(0, 8)})`,
        );
        if (mode === 'apply') {
          const r1 = await prisma.entityRelationship.updateMany({
            where: { userId, fromId: absorbed.id },
            data: { fromId: canonical.id },
          });
          const r2 = await prisma.entityRelationship.updateMany({
            where: { userId, toId: absorbed.id },
            data: { toId: canonical.id },
          });
          relsRepointed += r1.count + r2.count;
          await prisma.entity.update({
            where: { id: canonical.id },
            data: {
              aliases: mergedAliases,
              attributes: mergedAttrs as Prisma.InputJsonValue,
            },
          });
          await prisma.entity.delete({ where: { id: absorbed.id } });
          entitiesDeleted++;
        }
        s2Merges++;
      } catch (err) {
        s2Skipped++;
        console.warn(`${tag} S2: merge ${canonical.name} ← ${absorbed.name} failed:`, err);
      }
    }

    // ---------- Strategy 3: resolve-based dedup (russian FTS) ---------------
    // Catches declension/variant dups (different surface name, EMPTY aliases)
    // that S1/S2's JS name-equality misses. Re-fetch post-S2 state in apply
    // (mirrors the post-S1 re-fetch above); dry-run reuses the loaded rows.
    const postS2 =
      mode === 'apply'
        ? ((await prisma.entity.findMany({
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
          })) as unknown as EntityLite[])
        : rows;

    const s3 = await runS3ResolveBackfill(prisma, null, userId, mode, postS2);
    s3Merges += s3.merges;
    relsRepointed += s3.relsRepointed;
    oblsRepointed += s3.oblsRepointed;
    entitiesDeleted += s3.deleted;
  } catch (err) {
    console.warn(`${tag} top-level failure:`, err);
  }

  console.log('');
  console.log('=== dedup-entities summary ===');
  console.log(`user:              ${userId}`);
  console.log(`mode:              ${mode}`);
  console.log(`s1_merges:         ${s1Merges}`);
  console.log(`s1_skipped:        ${s1Skipped}`);
  console.log(`s2_merges:         ${s2Merges}`);
  console.log(`s2_skipped:        ${s2Skipped}`);
  console.log(`s3_merges:         ${s3Merges}`);
  console.log(`rels_repointed:    ${relsRepointed}`);
  console.log(`obls_repointed:    ${oblsRepointed}`);
  console.log(`entities_deleted:  ${entitiesDeleted}`);

  await prisma.$disconnect();
}

if (
  process.argv[1]?.endsWith('dedup-entities.ts') ||
  process.argv[1]?.endsWith('dedup-entities.js')
) {
  main().catch((e) => {
    console.error('dedup-entities fatal:', e);
    process.exit(1);
  });
}
