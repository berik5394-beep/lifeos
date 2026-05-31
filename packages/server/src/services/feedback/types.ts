/**
 * v2.0 Phase B3 — Cross-Session Learning (feedback loop) types + pure
 * helpers. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b3-cross-session-learning-design.md
 *
 * Pure helpers (isMoodDrop, looksLikeQuestion, parseFeedbackResponse,
 * NO_REACTION) are exported for unit testing without DB/Claude/Voyage.
 *
 * Feedback NEVER edits B2 traits directly — it routes axis signals into
 * the B1 store (source='feedback'). traits = f(axes, depth) follows.
 */

import {
  AXIS_NAMES,
  type AxisName,
  type AxisSignalInput,
  clampDelta,
  clampConfidence,
} from '../user-axes/index.js';

export type FeedbackValence = 'positive' | 'negative' | 'neutral';
export type FeedbackDimension = 'tone' | 'content' | 'understanding' | 'style';
export type FeedbackSignalType = 'explicit' | 'mood_drop' | 're_ask';

export interface ImplicitFlags {
  moodDropped: boolean;
  moodDelta: number | null;
  isReAsk: boolean;
  reaskSim: number | null;
}

export interface FeedbackResult {
  isReaction: boolean;
  valence: FeedbackValence;
  dimension: FeedbackDimension;
  axisSignals: AxisSignalInput[];
  styleNote: string | null;
}

const VALID_AXES: ReadonlySet<string> = new Set(AXIS_NAMES);
const VALENCES: ReadonlySet<string> = new Set(['positive', 'negative', 'neutral']);
const DIMENSIONS: ReadonlySet<string> = new Set([
  'tone', 'content', 'understanding', 'style',
]);

/** Safe "not a reaction" default — returned on any error / non-reaction. */
export const NO_REACTION: FeedbackResult = {
  isReaction: false,
  valence: 'neutral',
  dimension: 'content',
  axisSignals: [],
  styleNote: null,
};

/** Did the user's mood fall by more than `threshold` (valence units)? */
export function isMoodDrop(before: number, after: number,
                           threshold = 0.25): boolean {
  if (Number.isNaN(before) || Number.isNaN(after)) return false;
  return (before - after) > threshold;
}

const Q_LEAD = /^[\s]*(как|почему|зачем|что|когда|где|сколько|кто|какой|какая|какие|можешь|можно|а\s+если|разве|неужели)[\s\w]/i;

/** Cheap gate before paying for a Voyage embedding: is this a question? */
export function looksLikeQuestion(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length === 0) return false;
  if (t.endsWith('?')) return true;
  return Q_LEAD.test(t);
}

function coerceValence(v: unknown): FeedbackValence {
  return typeof v === 'string' && VALENCES.has(v)
    ? (v as FeedbackValence) : 'neutral';
}
function coerceDimension(d: unknown): FeedbackDimension {
  return typeof d === 'string' && DIMENSIONS.has(d)
    ? (d as FeedbackDimension) : 'content';
}

/** Defensive parser for the haiku classifier JSON. Never throws —
 *  any malformed input collapses to NO_REACTION. Mirrors B1
 *  parseAxisResponse (fence-strip, axis validation, clamp). */
export function parseFeedbackResponse(raw: string): FeedbackResult {
  if (!raw || !raw.trim()) return NO_REACTION;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn('[feedback:parse] JSON parse failed:',
      err instanceof Error ? err.message : err);
    return NO_REACTION;
  }
  if (!parsed || typeof parsed !== 'object') return NO_REACTION;
  const obj = parsed as Record<string, unknown>;

  const rawSignals = Array.isArray(obj.axisSignals) ? obj.axisSignals : [];
  const axisSignals: AxisSignalInput[] = [];
  for (const s of rawSignals) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.axis !== 'string' || !VALID_AXES.has(r.axis)) continue;
    const confidence = clampConfidence(Number(r.confidence));
    if (confidence <= 0) continue;
    const out: AxisSignalInput = {
      axis: r.axis as AxisName,
      delta: clampDelta(Number(r.delta)),
      confidence,
    };
    if (typeof r.excerpt === 'string') out.excerpt = r.excerpt.slice(0, 200);
    axisSignals.push(out);
  }

  const styleNote =
    typeof obj.styleNote === 'string' && obj.styleNote.trim()
      ? obj.styleNote.trim().slice(0, 200) : null;

  return {
    isReaction: obj.isReaction === true,
    valence: coerceValence(obj.valence),
    dimension: coerceDimension(obj.dimension),
    axisSignals,
    styleNote,
  };
}
