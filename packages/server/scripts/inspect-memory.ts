/**
 * READ-ONLY inspection of Memory + UserProfile в проде.
 *
 * Назначение: понять текущее состояние памяти (volume, distribution,
 * embeddings backfill need, sparse-overwrite risk surface) ПЕРЕД
 * любым изменением логики дедупа.
 *
 * Privacy: НИКАКОГО raw content в output — только aggregates (counts,
 * percentiles, fill-ratios). Логи Aydana/Berik никуда не утекают.
 *
 * Запуск:
 *   cd packages/server
 *   DATABASE_URL='postgresql://...' npx tsx scripts/inspect-memory.ts
 *
 * Безопасность: только SELECT, никаких INSERT/UPDATE/DELETE.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Section {
  title: string;
  rows: Record<string, unknown>[] | { note: string };
}

async function main(): Promise<void> {
  const out: Section[] = [];

  // 1. Volume per user (без user-id leaking — anonimизируем индексом)
  const perUser = await prisma.$queryRaw<
    Array<{ user_idx: number; total: bigint }>
  >`
    WITH ranked AS (
      SELECT "userId", COUNT(*) AS total,
             ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS user_idx
      FROM "Memory"
      GROUP BY "userId"
    )
    SELECT user_idx::int AS user_idx, total
    FROM ranked
    ORDER BY user_idx;
  `;
  out.push({
    title: '1. Memory rows per user (anonymized)',
    rows: perUser.map((r) => ({ user_idx: r.user_idx, total: Number(r.total) })),
  });

  // 2. Type distribution (агрегат по всем юзерам)
  const byType = await prisma.$queryRaw<
    Array<{ type: string; n: bigint; avg_len: number; p50: number; p90: number; sparse_lt_30: bigint }>
  >`
    SELECT type,
           COUNT(*) AS n,
           ROUND(AVG(LENGTH(content)))::int AS avg_len,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY LENGTH(content))::int AS p50,
           PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY LENGTH(content))::int AS p90,
           COUNT(*) FILTER (WHERE LENGTH(content) < 30) AS sparse_lt_30
    FROM "Memory"
    GROUP BY type
    ORDER BY n DESC;
  `;
  out.push({
    title: '2. Type distribution + content length (sparse-overwrite surface)',
    rows: byType.map((r) => ({
      type: r.type,
      n: Number(r.n),
      avg_len: r.avg_len,
      p50_len: r.p50,
      p90_len: r.p90,
      sparse_lt_30: Number(r.sparse_lt_30),
    })),
  });

  // 3. Embedding NULL ratio (для backfill решения)
  const embedRows = await prisma.$queryRaw<
    Array<{ total: bigint; with_embed: bigint; null_embed: bigint }>
  >`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS with_embed,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS null_embed
    FROM "Memory";
  `;
  out.push({
    title: '3. Embedding fill state',
    rows: embedRows.map((r) => ({
      total: Number(r.total),
      with_embedding: Number(r.with_embed),
      null_embedding: Number(r.null_embed),
      fill_pct:
        Number(r.total) > 0
          ? Math.round((Number(r.with_embed) / Number(r.total)) * 100)
          : 0,
    })),
  });

  // 4. Potential duplicate-prefix candidates (БЕЗ leaking content)
  // Группируем по (userId, type, first-20-chars) — сколько групп с n>1?
  const dupGroups = await prisma.$queryRaw<
    Array<{ type: string; dup_groups: bigint; max_n_in_group: bigint }>
  >`
    SELECT type,
           COUNT(*) AS dup_groups,
           MAX(n) AS max_n_in_group
    FROM (
      SELECT type, "userId", LEFT(content, 20) AS prefix, COUNT(*) AS n
      FROM "Memory"
      WHERE type IN ('person', 'fact', 'preference', 'decision')
      GROUP BY type, "userId", LEFT(content, 20)
      HAVING COUNT(*) > 1
    ) sub
    GROUP BY type
    ORDER BY type;
  `;
  out.push({
    title:
      '4. Duplicate-prefix groups (STABLE_TYPES, first 20 chars match, n>1) — without content leak',
    rows:
      dupGroups.length > 0
        ? dupGroups.map((r) => ({
            type: r.type,
            dup_groups: Number(r.dup_groups),
            max_n_in_group: Number(r.max_n_in_group),
          }))
        : { note: 'No duplicate-prefix groups found in STABLE_TYPES' },
  });

  // 5. UserProfile fill state per user (anonymized)
  const profileRows = await prisma.$queryRaw<
    Array<{
      user_idx: number;
      values_n: number;
      triggers_n: number;
      patterns_n: number;
      relationships_n: number;
      has_style_notes: boolean;
      synth_version: number;
      last_synth_days_ago: number | null;
    }>
  >`
    WITH ranked AS (
      SELECT "userId",
             jsonb_array_length(values) AS values_n,
             jsonb_array_length(triggers) AS triggers_n,
             jsonb_array_length(patterns) AS patterns_n,
             (SELECT COUNT(*)::int FROM jsonb_object_keys(relationships)) AS rel_n,
             ("styleNotes" IS NOT NULL AND LENGTH("styleNotes") > 0) AS has_style,
             "synthesisVersion" AS sv,
             "lastSynthesizedAt" AS lsa,
             ROW_NUMBER() OVER (ORDER BY "userId") AS user_idx
      FROM "UserProfile"
    )
    SELECT user_idx::int AS user_idx,
           values_n,
           triggers_n,
           patterns_n,
           rel_n AS relationships_n,
           has_style AS has_style_notes,
           sv AS synth_version,
           CASE WHEN lsa IS NULL THEN NULL
                ELSE EXTRACT(DAY FROM (NOW() - lsa))::int
           END AS last_synth_days_ago
    FROM ranked
    ORDER BY user_idx;
  `;
  out.push({
    title: '5. UserProfile fill state (anonymized per-user)',
    rows: profileRows.length > 0 ? profileRows : { note: 'No UserProfile rows' },
  });

  // 6. Source distribution (откуда приходят memories)
  const bySource = await prisma.$queryRaw<Array<{ source: string; n: bigint }>>`
    SELECT source, COUNT(*) AS n
    FROM "Memory"
    GROUP BY source
    ORDER BY n DESC;
  `;
  out.push({
    title: '6. Memory source distribution',
    rows: bySource.map((r) => ({ source: r.source, n: Number(r.n) })),
  });

  // 7. Expiry state
  const expiry = await prisma.$queryRaw<
    Array<{ active: bigint; expired: bigint; no_expiry: bigint }>
  >`
    SELECT COUNT(*) FILTER (WHERE "expiresAt" IS NOT NULL AND "expiresAt" > NOW()) AS active,
           COUNT(*) FILTER (WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= NOW()) AS expired,
           COUNT(*) FILTER (WHERE "expiresAt" IS NULL) AS no_expiry
    FROM "Memory";
  `;
  out.push({
    title: '7. Expiry state',
    rows: expiry.map((r) => ({
      active_ttl: Number(r.active),
      expired_still_in_db: Number(r.expired),
      no_expiry: Number(r.no_expiry),
    })),
  });

  // 8. Importance distribution
  const imp = await prisma.$queryRaw<
    Array<{ type: string; min: number; avg: number; max: number; high_n: bigint }>
  >`
    SELECT type,
           MIN(importance)::int AS min,
           ROUND(AVG(importance))::int AS avg,
           MAX(importance)::int AS max,
           COUNT(*) FILTER (WHERE importance >= 8) AS high_n
    FROM "Memory"
    GROUP BY type
    ORDER BY type;
  `;
  out.push({
    title: '8. Importance distribution per type',
    rows: imp.map((r) => ({
      type: r.type,
      min: r.min,
      avg: r.avg,
      max: r.max,
      high_8plus: Number(r.high_n),
    })),
  });

  // Print
  console.log('\n=== Memory inspection report (read-only) ===\n');
  for (const section of out) {
    console.log(`### ${section.title}`);
    if (Array.isArray(section.rows)) {
      if (section.rows.length === 0) {
        console.log('  (empty)');
      } else {
        console.table(section.rows);
      }
    } else {
      console.log(`  ${section.rows.note}`);
    }
    console.log('');
  }
}

main()
  .catch((e) => {
    console.error('inspect failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
