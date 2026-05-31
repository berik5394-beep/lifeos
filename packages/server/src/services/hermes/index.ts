/**
 * v2.0 Phase B4 — Hermes public entry point.
 * Lazy singleton + test reset. Mirrors user-axes/index.ts and feedback/index.ts.
 */

export {
  type SkillStep,
  type SkillSpec,
  MAX_STEPS,
  BLOCKLIST,
  SkillValidationError,
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
} from './types.js';

export { buildSkillFromRequest, proposeSkillFromPattern } from './skill-builder.js';
export { routeToSkill } from './skill-router.js';
export { PostgresHermes, type HermesStore } from './postgres-impl.js';
export { runSkillPlan, partitionSteps } from './skill-runner.js';
export { resolveSkillArgs, parseArgsResponse } from './arg-resolver.js';

import { PostgresHermes } from './postgres-impl.js';
import type { HermesStore } from './postgres-impl.js';

let _instance: HermesStore | null = null;

/**
 * Global singleton instance of the Hermes store. Lazily instantiated on
 * first call. Uses PostgresHermes by default.
 *
 * Wired into v2-capture (Task D2) and other downstream tasks.
 */
export function getHermesStore(): HermesStore {
  if (!_instance) {
    _instance = new PostgresHermes();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files. Underscore prefix
 * signals internal API.
 */
export function _resetHermesForTests(): void {
  _instance = null;
}
