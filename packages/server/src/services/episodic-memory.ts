// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { prisma } from '../lib/prisma.js'; // будет использовано в C2
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Memory } from '@prisma/client'; // будет использовано в C2

/**
 * v2.0 Tier 2 — Episodic Memory.
 *
 * События во времени с validity windows (Graphiti pattern):
 * - validAt: когда event случился (default now)
 * - invalidAt: когда event стал недействителен (null = действующий)
 *
 * Builds on Memory table + Tier 2 extension fields (validAt/invalidAt/
 * entityRefs/mood — added in Task A1).
 *
 * Architecture: pure helpers (validateEventInput, clampMood) separately
 * from async prisma wrappers — следует existing pattern из
 * memory-service.ts (shouldOverwriteContent / computeExpiresAt pure +
 * captureMemory / getRelevantMemories async).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordEventInput = {
  type: string;
  content: string;
  details?: string;
  entityRefs?: string[];
  /** -1..+1 emotional valence; clamped silently if out of range */
  mood?: number;
  /** When event occurred; default now() */
  validAt?: Date;
  /** Optional explicit invalidation timestamp (e.g. event already cancelled when recorded). */
  invalidAt?: Date;
  /** 1-10; default 5 */
  importance?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Clamp mood value to [-1, +1] range. Undefined → undefined (no override).
 */
export function clampMood(mood: number | undefined): number | undefined {
  if (mood === undefined) return undefined;
  return Math.max(-1, Math.min(1, mood));
}

/**
 * Validate RecordEventInput. Throws Error with message if invalid.
 * Returns nothing on success.
 *
 * Rules:
 * - content must be non-empty (trimmed)
 * - type must be non-empty
 * - invalidAt (if provided) must be >= validAt
 * - importance (if provided) must be in [1, 10]
 */
export function validateEventInput(input: RecordEventInput): void {
  if (!input.type || input.type.trim().length === 0) {
    throw new Error('validateEventInput: type must be non-empty');
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new Error('validateEventInput: content must be non-empty');
  }
  if (input.invalidAt && input.validAt && input.invalidAt < input.validAt) {
    throw new Error(
      `validateEventInput: invalidAt (${input.invalidAt.toISOString()}) cannot be before validAt (${input.validAt.toISOString()}) — validAt must precede invalidAt`,
    );
  }
  if (input.importance !== undefined) {
    if (input.importance < 1 || input.importance > 10) {
      throw new Error(`validateEventInput: importance must be in [1, 10], got ${input.importance}`);
    }
  }
}
