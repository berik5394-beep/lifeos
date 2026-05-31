import { describe, it, expect } from 'vitest';
import {
  getFeedbackStore,
  _resetFeedbackForTests,
  classifyFeedback,
  detectMoodDrop,
  detectReAsk,
  looksLikeQuestion,
  NO_REACTION,
} from './index.js';

describe('feedback/index', () => {
  it('getFeedbackStore returns a stable singleton', () => {
    _resetFeedbackForTests();
    const a = getFeedbackStore();
    const b = getFeedbackStore();
    expect(a).toBe(b);
    expect(typeof a.applyFeedback).toBe('function');
    expect(typeof a.recentCorrections).toBe('function');
  });
  it('reset yields a fresh instance', () => {
    const a = getFeedbackStore();
    _resetFeedbackForTests();
    const b = getFeedbackStore();
    expect(a).not.toBe(b);
  });
  it('re-exports the public surface', () => {
    expect(typeof classifyFeedback).toBe('function');
    expect(typeof detectMoodDrop).toBe('function');
    expect(typeof detectReAsk).toBe('function');
    expect(typeof looksLikeQuestion).toBe('function');
    expect(NO_REACTION.isReaction).toBe(false);
  });
});
