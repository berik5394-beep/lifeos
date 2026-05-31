/**
 * v2.0 Phase B2 — BotTraitsStore public entry point.
 *
 * Lazy singleton + test reset. Mirrors user-axes/index.ts pattern.
 * Wired into orchestrator (D1), proactivity (D2), telegram (E1), cron (E2).
 */

export {
  BOT_TRAIT_NAMES,
  DEFAULT_TRAITS,
  type BotTraitName,
  type BotTraits,
  type BotTraitsStore,
  type RelationshipStats,
  type TraitSnapshot,
  logNorm,
  computeRelationshipDepth,
  computeBotTraits,
  traitLabel,
  parseTraitsJson,
} from './types.js';

export { PostgresBotTraits } from './postgres-impl.js';

import { PostgresBotTraits } from './postgres-impl.js';
import type { BotTraitsStore } from './types.js';

let _instance: BotTraitsStore | null = null;

/** Global lazy singleton of the bot-traits store. */
export function getBotTraitsStore(): BotTraitsStore {
  if (!_instance) {
    _instance = new PostgresBotTraits();
  }
  return _instance;
}

/** For tests only — clear singleton between test files. */
export function _resetBotTraitsForTests(): void {
  _instance = null;
}
