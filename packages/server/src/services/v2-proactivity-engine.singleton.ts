/**
 * v2.0 Week 5 — singleton accessor for ProactivityEngine.
 * Mirrors procedural-memory.singleton.ts. Wired from proactive-scheduler
 * (E1) behind isV2ProactivityEnabled flag.
 */
import { V2ProactivityEngine } from './v2-proactivity-engine.js';
import type { ProactivityEngine } from './v2-proactivity-engine.js';

let _instance: ProactivityEngine | null = null;

export function getProactivityEngine(): ProactivityEngine {
  if (!_instance) _instance = new V2ProactivityEngine();
  return _instance;
}

export function _resetProactivityEngineForTests(): void {
  _instance = null;
}
