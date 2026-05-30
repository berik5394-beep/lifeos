/**
 * v2.0 Phase B1 — one-time bootstrap of UserAxes from UserProfile.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md §9
 *
 * Usage:
 *   npx tsx packages/server/scripts/bootstrap-axes.ts --user=<id> --dry-run
 *   npx tsx packages/server/scripts/bootstrap-axes.ts --user=<id> --apply
 *
 * What it does (--apply):
 *   1. Read UserProfile (patterns + triggers + styleNotes).
 *   2. Ask Claude haiku to estimate initial values for 4 axes from the
 *      profile context.
 *   3. Skip if user already has real signals (claude_classifier source).
 *   4. Else: write bootstrap signals into AxisSignal log, and write
 *      UserAxes row directly with the estimated values (overriding 0.5
 *      defaults) — use BOOTSTRAP_ALPHA=0.30 so signal lands more
 *      aggressively than steady-state α=0.05.
 *
 * Idempotent: re-running on a user with prior bootstrap is OK, will skip
 * if real signals exist. Multiple bootstrap runs without real signals
 * will overwrite estimates (last writer wins).
 */

import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../src/lib/models.js';
import { AXIS_NAMES, type AxisName } from '../src/services/user-axes/index.js';

const BOOTSTRAP_ALPHA = 0.30;

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

const BOOTSTRAP_SYSTEM_PROMPT = `Дан psycho-profile пользователя (накопленный LifeOS из long-term observation).
Оцени 4 личностные оси для starting calibration новой системы.

ОСИ:
- self_discipline (0..1): склонность follow-through на обещания
- emotional_openness (0..1): готовность делиться чувствами
- conflict_tolerance (0..1): аппетит к pushback / критике
- introspection_depth (0..1): self-reflection / causal thinking

ПРАВИЛА:
1. Верни ТОЛЬКО валидный JSON. Без markdown.
2. Для КАЖДОЙ из 4 осей — return value.
3. Justification — короткая фраза-обоснование из profile.

ФОРМАТ:
{
  "axes": [
    {"axis": "self_discipline", "value": 0.25, "justification": "..."},
    {"axis": "emotional_openness", "value": 0.7, "justification": "..."},
    {"axis": "conflict_tolerance", "value": 0.4, "justification": "..."},
    {"axis": "introspection_depth", "value": 0.55, "justification": "..."}
  ]
}`;

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('bootstrap-axes:', parsed.error);
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  console.log(`[bootstrap-axes] user=${userId} mode=${mode}`);

  try {
    // Skip if real signals already exist
    const realSignalCount = await prisma.axisSignal.count({
      where: { userId, source: 'claude_classifier' },
    });
    if (realSignalCount > 0) {
      console.log(`${tag} SKIP — user already has ${realSignalCount} real signals (source=claude_classifier)`);
      return;
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { patterns: true, triggers: true, styleNotes: true, values: true, relationships: true },
    });
    if (!profile) {
      console.log(`${tag} No UserProfile for ${userId} — leaving defaults 0.5 on all axes`);
      return;
    }

    const profileText = JSON.stringify(
      {
        patterns: profile.patterns,
        triggers: profile.triggers,
        styleNotes: profile.styleNotes,
        values: profile.values,
        relationships: profile.relationships,
      },
      null,
      2,
    );

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 800,
      system: BOOTSTRAP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: profileText }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.error(`${tag} Claude returned empty/non-text response`);
      return;
    }

    let estimated: Array<{ axis: AxisName; value: number; justification: string }>;
    try {
      let txt = content.text.trim();
      if (txt.startsWith('```')) {
        txt = txt.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
      }
      const parsed = JSON.parse(txt);
      estimated = Array.isArray(parsed.axes) ? parsed.axes : [];
    } catch (err) {
      console.error(`${tag} Could not parse Claude response:`, err);
      return;
    }

    console.log(`${tag} Claude estimated:`);
    for (const e of estimated) {
      console.log(`  ${e.axis} = ${e.value.toFixed(2)} — ${e.justification}`);
    }

    if (mode === 'dry-run') {
      console.log(`${tag} (dry-run — no DB writes)`);
      return;
    }

    // Apply: write bootstrap signals + UserAxes row
    const validEstimates = estimated.filter(
      (e) => typeof e.axis === 'string' &&
        AXIS_NAMES.includes(e.axis as AxisName) &&
        typeof e.value === 'number',
    );

    if (validEstimates.length === 0) {
      console.error(`${tag} No valid axis estimates`);
      return;
    }

    // Write AxisSignal rows (source=bootstrap)
    for (const e of validEstimates) {
      // Compute delta needed to move from 0.5 to e.value with α=0.30
      // applyEwma: next = α*target + (1-α)*current
      // Solving target so next=e.value: target = (e.value - (1-α)*0.5) / α
      //   = (e.value - 0.35) / 0.30
      // Then delta = target - 0.5 (assuming confidence=1)
      const target = (e.value - (1 - BOOTSTRAP_ALPHA) * 0.5) / BOOTSTRAP_ALPHA;
      const clampedTarget = Math.max(0, Math.min(1, target));
      const delta = clampedTarget - 0.5;
      await prisma.axisSignal.create({
        data: {
          userId,
          msgId: null,
          axis: e.axis,
          delta,
          confidence: 1.0,
          excerpt: e.justification.slice(0, 200),
          source: 'bootstrap',
        },
      });
    }

    // Set UserAxes row to the estimated values directly (overwrite defaults)
    const axisFieldByName: Record<AxisName, string> = {
      self_discipline: 'selfDiscipline',
      emotional_openness: 'emotionalOpenness',
      conflict_tolerance: 'conflictTolerance',
      introspection_depth: 'introspectionDepth',
    };
    const updateData: Record<string, unknown> = {
      signalCount: validEstimates.length,
      lastSignalAt: new Date(),
    };
    for (const e of validEstimates) {
      updateData[axisFieldByName[e.axis]] = e.value;
    }

    await prisma.userAxes.upsert({
      where: { userId },
      create: {
        userId,
        ...updateData,
      },
      update: updateData,
    });

    console.log(`${tag} ✓ Bootstrap applied. Wrote ${validEstimates.length} bootstrap signals + UserAxes row.`);
  } catch (err) {
    console.error('bootstrap-axes failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]?.endsWith('bootstrap-axes.ts') ||
  process.argv[1]?.endsWith('bootstrap-axes.js')
) {
  main().catch((e) => {
    console.error('bootstrap-axes fatal:', e);
    process.exit(1);
  });
}
