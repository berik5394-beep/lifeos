/**
 * v2.0 Phase B1 — USER NEST Axes types and pure helpers.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
 *
 * Pure helpers (clampDelta, clampConfidence, axisLabel, applyEwma) are
 * exported for unit testing without DB or Claude dependencies.
 *
 * All axis values are continuous Float in [0, 1] with semantic labels:
 *   [0.0, 0.2)   → очень низкая
 *   [0.2, 0.4)   → низкая
 *   [0.4, 0.6+]  → средняя  (default zone, includes 0.5 neutral)
 *   (0.6, 0.8]   → высокая
 *   (0.8, 1.0]   → очень высокая
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AxisName =
  | 'self_discipline'
  | 'emotional_openness'
  | 'conflict_tolerance'
  | 'introspection_depth';

export const AXIS_NAMES: readonly AxisName[] = [
  'self_discipline',
  'emotional_openness',
  'conflict_tolerance',
  'introspection_depth',
] as const;

export const AXIS_DEFAULTS: Record<AxisName, number> = {
  self_discipline: 0.5,
  emotional_openness: 0.5,
  conflict_tolerance: 0.5,
  introspection_depth: 0.5,
};

export interface UserAxesValues {
  selfDiscipline: number;
  emotionalOpenness: number;
  conflictTolerance: number;
  introspectionDepth: number;
  signalCount: number;
  lastSignalAt: Date | null;
}

export interface AxisSignalInput {
  axis: AxisName;
  delta: number;       // clamped to [-1, 1] on insert
  confidence: number;  // clamped to [0, 1] on insert
  excerpt?: string;
}

export type AxisSignalSource =
  | 'claude_classifier'
  | 'system_signal'
  | 'bootstrap'
  | 'manual';

export interface UserAxesStore {
  /** Read current values; auto-initialise row at 0.5 if missing. */
  getAxes(userId: string): Promise<UserAxesValues>;

  /** Append signals to AxisSignal log and recompute UserAxes via EWMA.
   *  Best-effort: never throws; returns counts of written vs skipped. */
  recordSignals(
    userId: string,
    msgId: string | null,
    signals: AxisSignalInput[],
    source?: AxisSignalSource,
  ): Promise<{ written: number; skipped: number }>;

  /** Latest N signals for a given axis (used by /axes Telegram command). */
  recentSignals(
    userId: string,
    axis: AxisName,
    limit?: number,
  ): Promise<Array<{
    delta: number;
    confidence: number;
    excerpt: string | null;
    recordedAt: Date;
  }>>;

  /** Recompute axes from full signal history. Used in tests + ad-hoc
   *  data fix; not in hot path. */
  recomputeFromSignals(userId: string): Promise<UserAxesValues>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB / Claude)
// ---------------------------------------------------------------------------

/** Clamp delta to [-1, 1]; NaN → 0. */
export function clampDelta(d: number): number {
  if (Number.isNaN(d)) return 0;
  return Math.max(-1, Math.min(1, d));
}

/** Clamp confidence to [0, 1]; NaN → 0. */
export function clampConfidence(c: number): number {
  if (Number.isNaN(c)) return 0;
  return Math.max(0, Math.min(1, c));
}

/** Russian semantic label for axis value. Used in /axes output and
 *  in system-prompt block. */
export function axisLabel(value: number): string {
  if (value < 0.2) return 'очень низкая';
  if (value < 0.4) return 'низкая';
  if (value <= 0.6) return 'средняя';
  if (value <= 0.8) return 'высокая';
  return 'очень высокая';
}

/**
 * Exponentially Weighted Moving Average (EWMA) — single update step.
 *
 * Formula:
 *   weighted = delta × confidence
 *   target   = clamp01(current + weighted)
 *   next     = α × target + (1 − α) × current
 *
 * α = 0.05 by default (slow drift — ~14 strong signals to move halfway).
 *
 * Math properties:
 *   - bounded to [0, 1] (target clamped)
 *   - asymptotic — never reaches 0 or 1 in finite steps
 *   - stable to single-day outliers
 *   - adaptive to persistent shifts
 */
export function applyEwma(
  current: number,
  delta: number,
  confidence: number,
  alpha: number = 0.05,
): number {
  const weighted = delta * confidence;
  const target = Math.max(0, Math.min(1, current + weighted));
  return alpha * target + (1 - alpha) * current;
}
