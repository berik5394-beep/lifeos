/**
 * v2.0 Tier 5 — singleton accessor for IdentityService.
 * Mirrors procedural-memory / emotional-memory singleton pattern.
 */

import { IdentityService } from './bot-identity.js';
import type { IdentityServiceStore } from './bot-identity.js';

let _instance: IdentityServiceStore | null = null;

export function getBotIdentityService(): IdentityServiceStore {
  if (!_instance) {
    _instance = new IdentityService();
  }
  return _instance;
}

export function _resetBotIdentityServiceForTests(): void {
  _instance = null;
}
