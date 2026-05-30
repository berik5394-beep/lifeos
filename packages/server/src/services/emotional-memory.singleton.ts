/**
 * v2.0 Tier 5 — singleton accessor for EmotionalMemory.
 * Mirrors procedural-memory.singleton.ts pattern.
 */

import { EmotionalMemory } from './emotional-memory.js';
import type { EmotionalMemoryStore } from './emotional-memory.js';

let _instance: EmotionalMemoryStore | null = null;

export function getEmotionalMemory(): EmotionalMemoryStore {
  if (!_instance) {
    _instance = new EmotionalMemory();
  }
  return _instance;
}

export function _resetEmotionalMemoryForTests(): void {
  _instance = null;
}
