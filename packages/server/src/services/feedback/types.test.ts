import { describe, it, expect } from 'vitest';
import {
  isMoodDrop,
  looksLikeQuestion,
  parseFeedbackResponse,
  NO_REACTION,
} from './types.js';

describe('isMoodDrop', () => {
  it('true when valence falls more than threshold', () => {
    expect(isMoodDrop(0.4, -0.1)).toBe(true);
  });
  it('false on small dip', () => {
    expect(isMoodDrop(0.2, 0.1)).toBe(false);
  });
  it('false on rise', () => {
    expect(isMoodDrop(-0.3, 0.4)).toBe(false);
  });
  it('respects custom threshold', () => {
    expect(isMoodDrop(0.5, 0.4, 0.05)).toBe(true);
  });
});

describe('looksLikeQuestion', () => {
  it('true on trailing ?', () => {
    expect(looksLikeQuestion('и что мне делать?')).toBe(true);
  });
  it('true on interrogative lead word', () => {
    expect(looksLikeQuestion('почему так вышло')).toBe(true);
    expect(looksLikeQuestion('Можешь повторить')).toBe(true);
  });
  it('false on a plain statement', () => {
    expect(looksLikeQuestion('сделал зарядку')).toBe(false);
  });
  it('false on empty', () => {
    expect(looksLikeQuestion('   ')).toBe(false);
  });
});

describe('NO_REACTION', () => {
  it('is a safe non-reaction default', () => {
    expect(NO_REACTION.isReaction).toBe(false);
    expect(NO_REACTION.axisSignals).toEqual([]);
    expect(NO_REACTION.styleNote).toBeNull();
  });
});

describe('parseFeedbackResponse', () => {
  it('parses a valid reaction', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'negative', dimension: 'tone',
      axisSignals: [{ axis: 'conflict_tolerance', delta: -0.1,
                      confidence: 0.8, excerpt: 'без нравоучений' }],
      styleNote: 'буду мягче',
    }));
    expect(r.isReaction).toBe(true);
    expect(r.valence).toBe('negative');
    expect(r.dimension).toBe('tone');
    expect(r.axisSignals).toHaveLength(1);
    expect(r.axisSignals[0].axis).toBe('conflict_tolerance');
    expect(r.styleNote).toBe('буду мягче');
  });
  it('strips markdown fences', () => {
    const r = parseFeedbackResponse(
      '```json\n{"isReaction":false,"valence":"neutral",' +
      '"dimension":"content","axisSignals":[],"styleNote":null}\n```');
    expect(r.isReaction).toBe(false);
  });
  it('drops invalid axes and clamps deltas', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'negative', dimension: 'style',
      axisSignals: [
        { axis: 'nonsense', delta: 0.1, confidence: 0.5 },
        { axis: 'introspection_depth', delta: -9, confidence: 2 },
      ], styleNote: null,
    }));
    expect(r.axisSignals).toHaveLength(1);
    expect(r.axisSignals[0].delta).toBe(-1);
    expect(r.axisSignals[0].confidence).toBe(1);
  });
  it('coerces unknown valence/dimension to safe enums', () => {
    const r = parseFeedbackResponse(JSON.stringify({
      isReaction: true, valence: 'furious', dimension: 'vibes',
      axisSignals: [], styleNote: null,
    }));
    expect(r.valence).toBe('neutral');
    expect(r.dimension).toBe('content');
  });
  it('returns NO_REACTION on garbage', () => {
    expect(parseFeedbackResponse('not json').isReaction).toBe(false);
    expect(parseFeedbackResponse('').isReaction).toBe(false);
  });
});
