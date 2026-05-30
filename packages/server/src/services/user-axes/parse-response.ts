/**
 * v2.0 Phase B1 — Parser for Claude haiku axis-classification response.
 *
 * Handles all malformed cases gracefully — NEVER throws. Markdown fences
 * (with or without `json` tag) stripped. Invalid axis names dropped.
 * Out-of-range deltas/confidence clamped. Zero-confidence signals
 * filtered (they carry no information). Excerpts truncated to 200 chars.
 *
 * Pure function — no I/O.
 */

import {
  AXIS_NAMES,
  type AxisName,
  type AxisSignalInput,
  clampDelta,
  clampConfidence,
} from './types.js';

const VALID_AXES: ReadonlySet<string> = new Set(AXIS_NAMES);

export interface ParsedAxisResponse {
  signals: AxisSignalInput[];
}

export function parseAxisResponse(raw: string): ParsedAxisResponse {
  const empty: ParsedAxisResponse = { signals: [] };
  if (!raw || !raw.trim()) return empty;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(
      '[user-axes:parse] JSON parse failed:',
      err instanceof Error ? err.message : err,
    );
    return empty;
  }

  if (!parsed || typeof parsed !== 'object') return empty;
  const obj = parsed as Record<string, unknown>;
  const rawSignals = Array.isArray(obj.signals) ? obj.signals : null;
  if (!rawSignals) return empty;

  const signals: AxisSignalInput[] = [];
  for (const s of rawSignals) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.axis !== 'string' || !VALID_AXES.has(r.axis)) continue;

    const delta = clampDelta(Number(r.delta));
    const confidence = clampConfidence(Number(r.confidence));
    // Zero-confidence signals are noise — drop them.
    if (confidence <= 0) continue;

    const out: AxisSignalInput = {
      axis: r.axis as AxisName,
      delta,
      confidence,
    };
    if (typeof r.excerpt === 'string') {
      out.excerpt = r.excerpt.slice(0, 200);
    }
    signals.push(out);
  }

  return { signals };
}
