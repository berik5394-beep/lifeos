/**
 * v2.0 Tier 4 — singleton accessor for ProceduralMemory.
 *
 * Pattern mirrors entity-graph/index.ts (Week 3) and working-memory.ts.
 * Wired into jarvis-orchestrator in Week 5.
 */

import { ProceduralMemory } from './procedural-memory.js';
import type { ProceduralMemoryStore } from './procedural-memory.js';

let _instance: ProceduralMemoryStore | null = null;

export function getProceduralMemory(): ProceduralMemoryStore {
  if (!_instance) {
    _instance = new ProceduralMemory();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files.
 */
export function _resetProceduralMemoryForTests(): void {
  _instance = null;
}
