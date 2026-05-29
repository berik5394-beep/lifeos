/**
 * v2.0 Tier 3 — EntityExtractor: Claude-based entity + relationship extraction.
 *
 * Takes free text (chat message, dictation transcript) and returns:
 *   - entities detected (name, type, optional attributes)
 *   - relationships between detected entities
 *
 * Pattern mirrors extractFromTranscript in dictation-service.ts:
 *   - Single Claude call with JSON-only system prompt
 *   - Best-effort: failure → return empty arrays (never throws)
 *   - MODELS.haiku (fast, cheap — extraction is a batch classify task)
 *
 * Pure helpers (normalizeEntityName, parseExtractorResponse) are exported
 * separately for unit testing without DB/Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../lib/models.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEntityInput {
  /** Raw name from text — will be normalized by caller via upsertEntity. */
  name: string;
  /** 'person' | 'place' | 'concept' | 'goal' | 'organization' */
  type: string;
  /** Optional free-form attributes extracted from context. */
  attributes?: Record<string, unknown>;
  /** 1-10 importance signal from extraction context. Default 5. */
  importance?: number;
}

export interface ExtractedRelationshipInput {
  /** Name of the "from" entity (matches entities[] name). */
  fromName: string;
  /** Name of the "to" entity (matches entities[] name). */
  toName: string;
  /**
   * Relationship type: 'family'|'friend'|'colleague'|'partner'|
   * 'concern'|'goal_link'|'location'|'works_at'|'lives_in'|'connected_to'
   */
  type: string;
  /** Optional free-form label. */
  label?: string;
  /** 0..1 estimated relationship strength. Default 0.5. */
  strength?: number;
}

export interface ExtractorResult {
  entities: ExtractedEntityInput[];
  relationships: ExtractedRelationshipInput[];
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB/Claude)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw entity name from Claude extraction:
 *   - trim leading/trailing whitespace
 *   - collapse internal whitespace to single space
 *   - capitalize first letter
 *
 * Examples: "  мама  " → "Мама", "Серик   Жумабаев" → "Серик Жумабаев"
 */
export function normalizeEntityName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Parse Claude JSON response into ExtractorResult.
 * Handles:
 *   - Markdown code fences (```json ... ```)
 *   - Missing keys → empty arrays
 *   - Non-array values → empty arrays
 *   - Invalid JSON → empty arrays (log warn, never throw)
 */
export function parseExtractorResponse(raw: string): ExtractorResult {
  const empty: ExtractorResult = { entities: [], relationships: [] };
  if (!raw || !raw.trim()) return empty;

  let text = raw.trim();
  // Strip markdown code fences (same pattern as dictation-service.ts).
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const entities = Array.isArray(parsed.entities)
      ? (parsed.entities as ExtractedEntityInput[])
      : [];
    const relationships = Array.isArray(parsed.relationships)
      ? (parsed.relationships as ExtractedRelationshipInput[])
      : [];
    return { entities, relationships };
  } catch (err) {
    console.warn('[entity-extractor] JSON parse failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Async API (Claude call — implemented in Task C2)
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/**
 * Extract entities and relationships from free text via Claude.
 * Best-effort: any error → returns empty ExtractorResult (never throws).
 * Uses MODELS.haiku (fast, cheap — extraction is classify, not reasoning).
 *
 * Implemented in Task C2.
 */
export async function extractEntities(
  _text: string,
  _userId: string,
): Promise<ExtractorResult> {
  // Placeholder — implemented in C2.
  void anthropic; // reference to prevent unused-import lint
  return { entities: [], relationships: [] };
}
