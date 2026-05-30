/**
 * v2.0 Phase B1 — UserAxesStore public entry point.
 *
 * Lazy singleton + test reset helper. Mirrors the pattern from
 * entity-graph/index.ts and procedural-memory.singleton.ts.
 *
 * Wired into v2-capture and telegram-bot in subsequent tasks (D2, E1).
 */

export {
  AXIS_NAMES,
  AXIS_DEFAULTS,
  type AxisName,
  type AxisSignalInput,
  type AxisSignalSource,
  type UserAxesStore,
  type UserAxesValues,
  clampDelta,
  clampConfidence,
  axisLabel,
  applyEwma,
} from './types.js';

export { PostgresUserAxes } from './postgres-impl.js';
export { parseAxisResponse } from './parse-response.js';

import { PostgresUserAxes } from './postgres-impl.js';
import type { UserAxesStore } from './types.js';

let _instance: UserAxesStore | null = null;

/**
 * Global singleton instance of the UserAxes store. Lazily instantiated on
 * first call. Uses PostgresUserAxes by default.
 *
 * Wired into v2-capture (Task D2) and /axes Telegram command (Task E1).
 */
export function getUserAxesStore(): UserAxesStore {
  if (!_instance) {
    _instance = new PostgresUserAxes();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files. Underscore prefix
 * signals internal API.
 */
export function _resetUserAxesForTests(): void {
  _instance = null;
}
