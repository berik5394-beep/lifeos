/**
 * v2.0 Phase B3 — Feedback store public entry point.
 * Lazy singleton + test reset. Mirrors user-axes/index.ts.
 */

export {
  type FeedbackValence,
  type FeedbackDimension,
  type FeedbackSignalType,
  type FeedbackResult,
  type ImplicitFlags,
  NO_REACTION,
  isMoodDrop,
  looksLikeQuestion,
  parseFeedbackResponse,
} from './types.js';

export { classifyFeedback } from './classify-feedback.js';
export { detectMoodDrop } from './detect-mood-drop.js';
export { detectReAsk } from './detect-reask.js';
export {
  PostgresFeedback,
  type FeedbackStore,
  type RecentCorrection,
} from './postgres-impl.js';

import { PostgresFeedback } from './postgres-impl.js';
import type { FeedbackStore } from './postgres-impl.js';

let _instance: FeedbackStore | null = null;

export function getFeedbackStore(): FeedbackStore {
  if (!_instance) _instance = new PostgresFeedback();
  return _instance;
}

export function _resetFeedbackForTests(): void {
  _instance = null;
}
