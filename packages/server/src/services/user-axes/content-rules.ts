/**
 * v2.0 Phase B1 — Content adaptation hard gates.
 *
 * Spec §7.4. Three pure helpers that take in current axes + context and
 * return a decision. No I/O — wiring into orchestrator/enrichment happens
 * elsewhere (Task D1, D2).
 *
 * Layered design: prompt enrichment (Layer 1, soft LLM judgment) handles
 * the majority of adaptation; these gates (Layer 2) catch the safety-
 * critical cases where Claude tends to ignore soft instructions.
 */

import type { UserAxesValues } from './types.js';

// ---------------------------------------------------------------------------
// Gate 1 — Goal decomposition: low self-discipline → enforce 1-step
// ---------------------------------------------------------------------------

/**
 * Determine whether bot's draft response should be regenerated with a
 * 1-step constraint.
 *
 * Fires when:
 *  - selfDiscipline < 0.3 (struggles with follow-through), AND
 *  - proposed step count > 1
 *
 * Protects user from being set up for failure (bot proposing 5 habits
 * when user can barely sustain 1).
 */
export function shouldForceOneStep(
  axes: UserAxesValues,
  proposedStepCount: number,
): { force: boolean; reason?: string } {
  if (axes.selfDiscipline < 0.3 && proposedStepCount > 1) {
    return {
      force: true,
      reason: `selfDiscipline=${axes.selfDiscipline.toFixed(2)} (< 0.3); ` +
        `proposed ${proposedStepCount} steps. Force ONE.`,
    };
  }
  return { force: false };
}

// ---------------------------------------------------------------------------
// Gate 2 — Emotional probing: low EO → suppress "что чувствуешь?" probes
// ---------------------------------------------------------------------------

/**
 * Determine whether bot should suppress emotional-probing language
 * ("что чувствуешь?", "как ты на самом деле?") in this turn.
 *
 * Fires when:
 *  - emotionalOpenness < 0.3 (user closed to emotional probes), AND
 *  - no recent emotional content from user (they haven't opened door), AND
 *  - at least 3 prior user messages (don't gate first interactions)
 *
 * @param recentUserMsgsCount — how many user msgs in this session/recent window
 * @param emotionalContentRecent — whether last few user msgs contained emotional vocab
 */
export function shouldSuppressEmotionalProbing(
  axes: UserAxesValues,
  recentUserMsgsCount: number,
  emotionalContentRecent: boolean,
): boolean {
  if (axes.emotionalOpenness >= 0.3) return false;
  if (emotionalContentRecent) return false; // user opened door first
  if (recentUserMsgsCount < 3) return false; // too early
  return true;
}

// ---------------------------------------------------------------------------
// Gate 3 — Soften challenge: low CT → rephrase assertions as questions
// ---------------------------------------------------------------------------

const ASSERTIVE_CHALLENGE_PATTERNS: RegExp[] = [
  /ты\s+не\s+прав/i,
  /это\s+неправильно/i,
  /ты\s+противоречишь/i,
  /перестань/i,
  /хватит/i,
  /ты\s+ошибаешься/i,
];

const REFRAME_GUIDANCE =
  'Replace assertion with curious question. ' +
  'Instead of "ты не прав" → "как ты сам это видишь?". ' +
  'Instead of "хватит" → "что тебя тянет к этому?".';

/**
 * Determine whether bot's draft response should be regenerated softer.
 *
 * Fires when:
 *  - conflictTolerance < 0.3 (user defensive when pushed), AND
 *  - draft contains assertive challenge language
 */
export function shouldSoftenChallenge(
  axes: UserAxesValues,
  draftReply: string,
): { soften: boolean; suggestedReframe?: string } {
  if (axes.conflictTolerance >= 0.3) return { soften: false };
  for (const pat of ASSERTIVE_CHALLENGE_PATTERNS) {
    if (pat.test(draftReply)) {
      return { soften: true, suggestedReframe: REFRAME_GUIDANCE };
    }
  }
  return { soften: false };
}

// ---------------------------------------------------------------------------
// Helper — extract proposed step count from bot's draft
// ---------------------------------------------------------------------------

/**
 * Heuristic count of distinct steps/items proposed in the draft. Used by
 * the orchestrator post-process to decide whether to invoke Gate 1.
 *
 * Counts:
 *  - numbered items "1.", "2.", "3.", etc.
 *  - bullet list items "- ", "* ", "• "
 *  - Russian enumerators ("во-первых", "во-вторых", "в-третьих", "в-четвёртых")
 *
 * Returns max of any of these (whichever style the draft uses).
 */
export function extractStepCount(draft: string): number {
  const numbered = (draft.match(/^\s*\d+\.\s+/gm) ?? []).length;
  const bullets = (draft.match(/^\s*[-*•]\s+/gm) ?? []).length;
  const enumWords = countRussianEnumerators(draft);
  return Math.max(numbered, bullets, enumWords);
}

function countRussianEnumerators(text: string): number {
  const t = text.toLowerCase();
  let count = 0;
  for (const word of ['во-первых', 'во-вторых', 'в-третьих', 'в-четвёртых', 'в-пятых']) {
    if (t.includes(word)) count++;
  }
  return count;
}
