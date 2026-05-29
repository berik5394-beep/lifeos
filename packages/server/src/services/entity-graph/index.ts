/**
 * v2.0 Tier 3 — Entity Graph public entry point.
 *
 * Exports interface, implementation, and singleton accessor.
 * Pattern mirrors working-memory.ts: lazy singleton + test reset.
 *
 * Singleton wired into jarvis-orchestrator in Week 5 (separate plan).
 */

export type { EntityGraphStore, Entity, EntityRelationship } from './types.js';
export { PostgresEntityGraph } from './postgres-impl.js';
export { clampDepth, sinceDaysCutoff } from './postgres-impl.js';

import { PostgresEntityGraph } from './postgres-impl.js';
import type { EntityGraphStore } from './types.js';

let _instance: EntityGraphStore | null = null;

/**
 * Global singleton instance of the entity graph store.
 * Created lazily on first call. Uses PostgresEntityGraph by default.
 *
 * Wired into jarvis-orchestrator in Week 5.
 */
export function getEntityGraph(): EntityGraphStore {
  if (!_instance) {
    _instance = new PostgresEntityGraph();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files.
 * Underscore prefix signals "internal API" (mirrors working-memory.ts pattern).
 */
export function _resetEntityGraphForTests(): void {
  _instance = null;
}
