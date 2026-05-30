/**
 * v2.0 Week 6 — manual migration script. Single-user scope.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §11
 *
 * Usage:
 *   # Preview only — NO writes:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run
 *
 *   # Apply:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply
 *
 * What it does (--apply):
 *   1. Backfill Memory.validAt = createdAt where NULL.
 *   2. Lift Memory rows into Entity graph (person/place/decision→goal).
 *   3. Upsert BotIdentity with defaults if not exists.
 *   4. Run getProceduralMemory().extractPatterns(userId) once at end.
 *
 * Idempotent — re-run safe. Per-step try/catch; partial failure doesn't
 * abort the rest. No $transaction (corpus is small, recoverable).
 */

import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from '../src/services/entity-graph/index.js';
import { getProceduralMemory } from '../src/services/procedural-memory.singleton.js';
import { extractEntities } from '../src/services/entity-extractor.js';
import type { JsonValue } from '@prisma/client/runtime/library';

// ---- Pure CLI parser ------------------------------------------------------

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
    return {
      error: 'Missing --user=<id>. Usage: --user=<id> --dry-run | --apply',
    };
  }
  if (dryRun && apply) {
    return { error: '--dry-run and --apply are mutually exclusive' };
  }
  if (!dryRun && !apply) {
    return { error: 'Pick a mode: --dry-run or --apply' };
  }
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

// ---- Memory row type -----------------------------------------------------

type MemoryRow = {
  id: string;
  type: string;
  content: string;
  importance: number;
};

/**
 * Q3 (2026-05-31) rewrite — was: take Memory.content as entity name
 * directly. That created junk like "Маму Берика зовут Роза, живёт в
 * Алматы" as a person entity, duplicating canonical "Роза" already
 * upserted by v2 extractor.
 *
 * Now: route every legacy Memory row's content through the same
 * Claude haiku extractor that v2-capture uses for live messages.
 * Returns 0..N canonical entities + relationships per row. We trust
 * the extractor's normalization + self-reference filter (Q1).
 *
 * Returns null if the row has no content. Errors swallowed (returns
 * empty result) — caller treats as "skipped".
 */
async function extractEntitiesFromMemory(
  m: MemoryRow,
  userId: string,
  userName: string | undefined,
): Promise<{ entities: Array<{ name: string; type: string; importance: number; attributes?: Record<string, unknown> }>; relationships: Array<{ fromName: string; toName: string; type: string; label?: string; strength?: number }> }> {
  if (!m.content || m.content.trim().length === 0) {
    return { entities: [], relationships: [] };
  }
  try {
    const out = await extractEntities(m.content, userId, userName);
    // Inherit at least the legacy importance (some rows are imp 8+ — preserve).
    const entities = out.entities.map((e) => ({
      name: e.name,
      type: e.type,
      importance: Math.max(e.importance ?? 5, m.importance),
      attributes: e.attributes,
    }));
    return { entities, relationships: out.relationships };
  } catch (err) {
    console.warn(`[migrate-to-v2] extract failed for memory.id=${m.id}:`, err);
    return { entities: [], relationships: [] };
  }
}

// ---- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('migrate-to-v2:', parsed.error);
    console.error(
      'Usage:\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply',
    );
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();

  console.log(`[migrate-to-v2] user=${userId} mode=${mode}`);
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';

  let memoriesBackfilled = 0;
  let entitiesCreated = 0;
  let entitiesSkipped = 0;
  let identityCreated = false;
  let patternsExtracted = 0;

  // Fetch user.name once — passed to extractEntities for self-ref filter (Q1).
  const userName = await prisma.user
    .findUnique({ where: { id: userId }, select: { name: true } })
    .then((u) => u?.name ?? undefined)
    .catch(() => undefined);

  // ---- Step 1: validAt backfill ------------------------------------------
  // Q3 fix (2026-05-31): Prisma 6.19 rejects `validAt: null as unknown as Date`
  // with strict validation. Use the documented `{ equals: null }` form.
  try {
    const candidates = await prisma.memory.count({
      where: { userId, validAt: { equals: null } },
    });
    console.log(`${tag} step 1: ${candidates} Memory rows with NULL validAt`);
    if (mode === 'apply' && candidates > 0) {
      // Raw SQL — Prisma cannot express "SET validAt = createdAt" cleanly.
      const result = await prisma.$executeRaw`
        UPDATE "Memory"
           SET "validAt" = "createdAt"
         WHERE "userId" = ${userId}
           AND "validAt" IS NULL
      `;
      memoriesBackfilled = Number(result);
      console.log(`${tag} step 1: backfilled ${memoriesBackfilled} rows`);
    }
  } catch (err) {
    console.warn(`${tag} step 1 failed:`, err);
  }

  // ---- Step 2: Memory → Entity lift via Claude extractor -----------------
  // Q3 fix (2026-05-31): the old mapMemoryToEntity took Memory.content as
  // entity.name verbatim — produced junk like "Маму зовут Роза..." as
  // person, duplicating canonical "Роза". Now we route every row through
  // the same haiku extractor used live, which yields canonical names +
  // attributes + relationships. Cost: 1 Claude call per Memory row
  // (~$0.0001 each), one-time.
  let relationshipsLifted = 0;
  try {
    const rows = (await prisma.memory.findMany({
      where: { userId },
      select: { id: true, type: true, content: true, importance: true },
    })) as MemoryRow[];
    console.log(`${tag} step 2: scanning ${rows.length} Memory rows via Claude extractor`);
    const graph = getEntityGraph();
    let memoriesProcessed = 0;
    let memoriesEmpty = 0;
    const seenNames = new Set<string>();
    for (const m of rows) {
      const extracted = await extractEntitiesFromMemory(m, userId, userName);
      if (extracted.entities.length === 0) {
        memoriesEmpty++;
        continue;
      }
      memoriesProcessed++;
      // Upsert entities first.
      const idByName = new Map<string, string>();
      for (const ent of extracted.entities) {
        const key = ent.name.toLowerCase();
        try {
          if (mode === 'dry-run') {
            const dupNote = seenNames.has(key) ? ' [already-seen]' : '';
            console.log(`${tag} step 2: would upsert ${ent.type}=${JSON.stringify(ent.name)} imp=${ent.importance}${dupNote}`);
            seenNames.add(key);
            entitiesCreated++;
          } else if (mode === 'apply') {
            const row = await graph.upsertEntity(userId, {
              type: ent.type,
              name: ent.name,
              importance: ent.importance,
              attributes: (ent.attributes ?? {}) as JsonValue,
            });
            idByName.set(ent.name, row.id);
            entitiesCreated++;
          }
        } catch (err) {
          entitiesSkipped++;
          console.warn(`${tag} step 2: upsert ${ent.name} failed:`, err);
        }
      }
      // Then relationships (apply only — dry-run just logs).
      for (const rel of extracted.relationships) {
        try {
          if (mode === 'dry-run') {
            console.log(`${tag} step 2: would link ${rel.fromName} -[${rel.type}]-> ${rel.toName}`);
            relationshipsLifted++;
          } else if (mode === 'apply') {
            const fromId =
              idByName.get(rel.fromName) ??
              (await graph.upsertEntity(userId, { type: 'person', name: rel.fromName })).id;
            const toId =
              idByName.get(rel.toName) ??
              (await graph.upsertEntity(userId, { type: 'person', name: rel.toName })).id;
            await graph.linkEntities(userId, fromId, toId, rel.type ?? 'connected_to', {
              label: rel.label,
              strength: rel.strength,
            });
            relationshipsLifted++;
          }
        } catch (err) {
          console.warn(`${tag} step 2: link ${rel.fromName}→${rel.toName} failed:`, err);
        }
      }
    }
    console.log(
      `${tag} step 2: processed=${memoriesProcessed} empty=${memoriesEmpty} → entities=${entitiesCreated} skipped=${entitiesSkipped} relationships=${relationshipsLifted}`,
    );
  } catch (err) {
    console.warn(`${tag} step 2 failed:`, err);
  }

  // ---- Step 3: BotIdentity upsert ----------------------------------------
  try {
    if (mode === 'dry-run') {
      const existing = await prisma.botIdentity.findUnique({ where: { userId } });
      if (existing) {
        console.log(`${tag} step 3: BotIdentity exists (botName=${existing.botName}) — no change`);
      } else {
        console.log(`${tag} step 3: would upsert BotIdentity { botName: 'Эля', style: 'warm' }`);
      }
    } else if (mode === 'apply') {
      const before = await prisma.botIdentity.findUnique({ where: { userId } });
      await prisma.botIdentity.upsert({
        where: { userId },
        create: { userId, botName: 'Эля', style: 'warm' },
        update: {},
      });
      if (!before) {
        identityCreated = true;
        console.log(`${tag} step 3: BotIdentity created`);
      } else {
        console.log(`${tag} step 3: BotIdentity exists (botName=${before.botName}) — no change`);
      }
    }
  } catch (err) {
    console.warn(`${tag} step 3 failed:`, err);
  }

  // ---- Step 4: UserProfile.relationships → Entity lift -------------------
  // (Q2 2026-05-31): Phase 6 life-truth-analyzer stores a structured
  // psycho-profile in UserProfile.relationships ({ "Серик": "деловой контакт..." }).
  // Those people are referenced in the bot's system prompt today, but they
  // are NOT in the v2 Entity graph — so getEntityMood/getNeighbors miss
  // them. Lift each profile relationship into a person Entity with the
  // description stored in attributes.profile_note.
  let profileLifted = 0;
  let profileSkipped = 0;
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { relationships: true },
    });
    const relMap = (profile?.relationships ?? {}) as Record<string, unknown>;
    const relEntries = Object.entries(relMap).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
    console.log(`${tag} step 4: UserProfile.relationships has ${relEntries.length} entries`);
    const graph = getEntityGraph();
    for (const [name, note] of relEntries) {
      try {
        if (mode === 'dry-run') {
          console.log(`${tag} step 4: would upsert profile-lift entity name=${JSON.stringify(name)} profile_note=${JSON.stringify(String(note).slice(0, 60))}`);
          profileLifted++;
        } else if (mode === 'apply') {
          await graph.upsertEntity(userId, {
            type: 'person',
            name,
            importance: 6,
            attributes: { profile_note: String(note), source: 'userprofile_lift' },
          });
          profileLifted++;
        }
      } catch (err) {
        profileSkipped++;
        console.warn(`${tag} step 4: profile-lift failed for ${name}:`, err);
      }
    }
    console.log(`${tag} step 4: ${profileLifted} lifted, ${profileSkipped} skipped`);
  } catch (err) {
    console.warn(`${tag} step 4 failed:`, err);
  }

  // ---- Step 5: extractPatterns -------------------------------------------
  try {
    if (mode === 'dry-run') {
      console.log(`${tag} step 5: would call extractPatterns(${userId})`);
    } else if (mode === 'apply') {
      const patterns = await getProceduralMemory().extractPatterns(userId);
      patternsExtracted = patterns.length;
      console.log(`${tag} step 5: extracted ${patternsExtracted} patterns`);
    }
  } catch (err) {
    console.warn(`${tag} step 5 failed:`, err);
  }

  // ---- Report ------------------------------------------------------------
  console.log('');
  console.log('=== migrate-to-v2 summary ===');
  console.log(`user:                ${userId}`);
  console.log(`mode:                ${mode}`);
  console.log(`memoriesBackfilled:  ${memoriesBackfilled}`);
  console.log(`entitiesCreated:     ${entitiesCreated}`);
  console.log(`entitiesSkipped:     ${entitiesSkipped}`);
  console.log(`relationshipsLifted: ${relationshipsLifted}`);
  console.log(`profileLifted:       ${profileLifted}`);
  console.log(`profileSkipped:      ${profileSkipped}`);
  console.log(`identityCreated:     ${identityCreated}`);
  console.log(`patternsExtracted:   ${patternsExtracted}`);

  await prisma.$disconnect();
}

if (
  process.argv[1]?.endsWith('migrate-to-v2.ts') ||
  process.argv[1]?.endsWith('migrate-to-v2.js')
) {
  main().catch((e) => {
    console.error('migrate-to-v2 fatal:', e);
    process.exit(1);
  });
}
