/**
 * v2.0 Phase B2 — Identity Evolution types and pure helpers.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md
 *
 * Pure helpers (logNorm, computeRelationshipDepth, computeBotTraits,
 * traitLabel, parseTraitsJson) exported for unit testing without DB/Claude.
 *
 * Trait values are continuous Float [0, 1]. Bot traits = f(user B1 axes,
 * relationshipDepth). Depth grows slowly with relationship tenure +
 * richness, so the bot's persona deepens (warmer, more direct, more
 * playful) over months.
 */

export type BotTraitName = 'warmth' | 'directness' | 'humor' | 'playfulness';

export const BOT_TRAIT_NAMES: readonly BotTraitName[] = [
  'warmth', 'directness', 'humor', 'playfulness',
] as const;

export interface BotTraits {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  relationshipDepth: number;
  lastComputedAt: Date | null;
}

export const DEFAULT_TRAITS: BotTraits = {
  warmth: 0.5,
  directness: 0.5,
  humor: 0.3,
  playfulness: 0.4,
  relationshipDepth: 0,
  lastComputedAt: null,
};

export interface RelationshipStats {
  messageCount: number;
  daysSinceFirst: number;
  distinctEntities: number;
  emotionalMoments: number;
}

export interface TraitSnapshot {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  depth: number;
  recordedAt: Date;
}

export interface BotTraitsStore {
  getTraits(userId: string): Promise<BotTraits>;
  refreshTraits(userId: string): Promise<BotTraits>;
  refreshTraitsIfStale(userId: string, staleMs?: number): Promise<BotTraits>;
  snapshot(userId: string): Promise<void>;
  snapshotHistory(userId: string, limit?: number): Promise<TraitSnapshot[]>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Logarithmic normalization — maps [0, ∞) to [0, 1) with diminishing
 * returns. Output ≈ 1 when value reaches `cap`. value ≤ 0 → 0.
 */
export function logNorm(value: number, cap: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(cap));
}

/**
 * relationshipDepth [0, 1] from interaction stats. Weighted:
 *   30% messages, 30% tenure, 20% entities, 20% emotional moments.
 * Caps: 500 msgs / 365 days / 100 entities / 50 emotional moments → deep.
 */
export function computeRelationshipDepth(stats: RelationshipStats): number {
  const msg = logNorm(stats.messageCount, 500);
  const days = logNorm(stats.daysSinceFirst, 365);
  const ent = logNorm(stats.distinctEntities, 100);
  const emo = logNorm(stats.emotionalMoments, 50);
  const weighted = 0.30 * msg + 0.30 * days + 0.20 * ent + 0.20 * emo;
  return Math.max(0, Math.min(1, weighted));
}

/**
 * Compute the 4 bot traits from user B1 axes + relationship depth.
 *
 *   warmth      = 0.45 + 0.30·userEO + 0.25·depth
 *   directness  = 0.30 + 0.45·userCT + 0.25·depth
 *   humor       = 0.20 + 0.50·depth  + 0.15·userEO
 *   playfulness = 0.30 + 0.30·depth  + 0.20·userEO
 *
 * Monotonic in depth (bot warms over time), responsive to user axes
 * (different bots for different users), all clamped [0, 1].
 */
export function computeBotTraits(
  userEO: number,
  userCT: number,
  depth: number,
): { warmth: number; directness: number; humor: number; playfulness: number } {
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return {
    warmth:      c(0.45 + 0.30 * userEO + 0.25 * depth),
    directness:  c(0.30 + 0.45 * userCT + 0.25 * depth),
    humor:       c(0.20 + 0.50 * depth + 0.15 * userEO),
    playfulness: c(0.30 + 0.30 * depth + 0.20 * userEO),
  };
}

/** Russian semantic label for a trait value (mirrors B1 axisLabel). */
export function traitLabel(value: number): string {
  if (value < 0.2) return 'очень низкий';
  if (value < 0.4) return 'низкий';
  if (value <= 0.6) return 'средний';
  if (value <= 0.8) return 'высокий';
  return 'очень высокий';
}

/**
 * Parse the BotIdentity.traits JSON blob into a typed BotTraits.
 * Missing fields fall back to DEFAULT_TRAITS. Malformed lastComputedAt
 * → null. Never throws.
 */
export function parseTraitsJson(raw: unknown): BotTraits {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRAITS };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;

  let lastComputedAt: Date | null = null;
  if (typeof o.lastComputedAt === 'string') {
    const d = new Date(o.lastComputedAt);
    if (!Number.isNaN(d.getTime())) lastComputedAt = d;
  }

  return {
    warmth: num(o.warmth, DEFAULT_TRAITS.warmth),
    directness: num(o.directness, DEFAULT_TRAITS.directness),
    humor: num(o.humor, DEFAULT_TRAITS.humor),
    playfulness: num(o.playfulness, DEFAULT_TRAITS.playfulness),
    relationshipDepth: num(o.relationshipDepth, DEFAULT_TRAITS.relationshipDepth),
    lastComputedAt,
  };
}
