/**
 * v2.0 Phase B2 — one-time bootstrap of bot traits for an existing user.
 *
 * Spec §11. Computes initial traits from accumulated data and writes the
 * first BotTraitSnapshot (baseline for the growth narrative).
 *
 * Usage:
 *   npx tsx packages/server/scripts/bootstrap-traits.ts --user=<id> --dry-run
 *   npx tsx packages/server/scripts/bootstrap-traits.ts --user=<id> --apply
 *
 * Idempotent-ish: re-running recomputes + adds another snapshot row
 * (harmless — narrative uses oldest, snapshots accumulate weekly anyway).
 */

import { PrismaClient } from '@prisma/client';
import { getBotTraitsStore } from '../src/services/bot-traits/index.js';

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
      if (val.length === 0) return { error: '--user=<id> requires a non-empty value' };
      userId = val;
    } else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--apply') apply = true;
  }
  if (!userId) return { error: 'Missing --user=<id>' };
  if (dryRun && apply) return { error: '--dry-run and --apply mutually exclusive' };
  if (!dryRun && !apply) return { error: 'Pick a mode: --dry-run or --apply' };
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('bootstrap-traits:', parsed.error);
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  console.log(`[bootstrap-traits] user=${userId} mode=${mode}`);

  try {
    // Show the stats that drive the computation.
    const [messageCount, firstMsg, distinctEntities, emotionalMoments] =
      await Promise.all([
        prisma.chatMessage.count({ where: { userId } }),
        prisma.chatMessage.findFirst({
          where: { userId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
        }),
        prisma.entity.count({ where: { userId } }),
        prisma.moodSnapshot.count({
          where: { userId, OR: [{ valence: { gt: 0.4 } }, { valence: { lt: -0.4 } }] },
        }),
      ]);
    const daysSinceFirst = firstMsg
      ? Math.max(0, (Date.now() - firstMsg.createdAt.getTime()) / 86400_000)
      : 0;
    console.log(`${tag} stats: msgs=${messageCount} days=${daysSinceFirst.toFixed(1)} entities=${distinctEntities} emotional=${emotionalMoments}`);

    if (mode === 'dry-run') {
      console.log(`${tag} would refreshTraits + write first snapshot (no DB writes)`);
      return;
    }

    const store = getBotTraitsStore();
    const traits = await store.refreshTraits(userId);
    await store.snapshot(userId);
    console.log(`${tag} ✓ Applied. Traits: warmth=${traits.warmth.toFixed(2)} directness=${traits.directness.toFixed(2)} humor=${traits.humor.toFixed(2)} playfulness=${traits.playfulness.toFixed(2)} depth=${traits.relationshipDepth.toFixed(2)}`);
  } catch (err) {
    console.error('bootstrap-traits failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]?.endsWith('bootstrap-traits.ts') ||
  process.argv[1]?.endsWith('bootstrap-traits.js')
) {
  main().catch((e) => {
    console.error('bootstrap-traits fatal:', e);
    process.exit(1);
  });
}
