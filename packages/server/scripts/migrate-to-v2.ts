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
 *   1. Backfill Memory.validAt = createdAt for rows where validAt IS NULL.
 *   2. Lift legacy Memory rows into the Entity graph (person/place/decision).
 *   3. Upsert BotIdentity with defaults if not exists.
 *   4. Run getProceduralMemory().extractPatterns(userId) once at end.
 *
 * No $transaction wrapping — Berik's corpus is small (~67 rows). A
 * partial migration is recoverable (re-run is idempotent: validAt
 * backfill is UPDATE WHERE NULL; entity upsert is unique-key based;
 * BotIdentity upsert is by userId).
 *
 * Safety: --apply requires explicit flag; default to printing help.
 * Tests in src/scripts/migrate-to-v2.test.ts (pure parser only — full
 * migration covered by C3 integration test against local Docker DB).
 */
import { PrismaClient } from '@prisma/client';

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
    // Unknown args are ignored (defensive).
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

  try {
    // B2 fills in the real migration logic. B1 only prints what WOULD run.
    console.log('[migrate-to-v2] (B1 skeleton) — no work performed.');
    console.log(
      '[migrate-to-v2] Run after B2 lands for the full migration logic.',
    );
  } catch (err) {
    console.error('[migrate-to-v2] failed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run as entrypoint, not when imported by tests.
if (process.argv[1]?.endsWith('migrate-to-v2.ts') ||
    process.argv[1]?.endsWith('migrate-to-v2.js')) {
  main().catch((e) => {
    console.error('migrate-to-v2 fatal:', e);
    process.exit(1);
  });
}
