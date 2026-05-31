/**
 * v2 P2 — Engagement-aware proactivity: pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-p2-engagement-proactivity-design.md
 *
 * No I/O — unit-tested in isolation. engagement.ts feeds these from DB.
 */

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));

/**
 * Recent responsiveness 0..1. Neutral 0.5 when there's no delivery history.
 * Rewards replies-after-nudge, penalises dismissals.
 */
export function receptivenessScore(
  delivered: number, dismissed: number, repliedWithin: number,
): number {
  if (delivered <= 0) return 0.5;
  const replyRate = clamp(repliedWithin / delivered, 0, 1);
  const dismissRate = clamp(dismissed / delivered, 0, 1);
  return clamp(0.5 + 0.4 * replyRate - 0.4 * dismissRate, 0, 1);
}

/**
 * Adaptive significance threshold around `base`. Low receptiveness → higher
 * bar (pester less); high → lower bar (catch more). Clamped to
 * [base-0.15, base+0.25].
 */
export function adaptiveThreshold(base: number, receptiveness: number): number {
  const raw = base + (0.5 - clamp(receptiveness, 0, 1)) * 0.5;
  return clamp(raw, base - 0.15, base + 0.25);
}

/** 24-slot count histogram of message local-hours (out-of-range ignored). */
export function activeHourHistogram(localHours: number[]): number[] {
  const hist = new Array<number>(24).fill(0);
  for (const h of localHours) {
    if (Number.isInteger(h) && h >= 0 && h < 24) hist[h] += 1;
  }
  return hist;
}

/**
 * Is `hour` a receptive hour? True when we lack enough data to judge
 * (empty or < 10 total messages) — never block on ignorance. Otherwise
 * the hour must hold ≥ minShare of messages.
 */
export function isReceptiveHour(hist: number[], hour: number, minShare = 0.05): boolean {
  if (!Array.isArray(hist) || hist.length !== 24) return true;
  const total = hist.reduce((s, n) => s + n, 0);
  if (total < 10) return true;
  if (!Number.isInteger(hour) || hour < 0 || hour >= 24) return true;
  return hist[hour] / total >= minShare;
}
