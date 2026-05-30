import { describe, it, expect } from 'vitest';
import { parseAxisResponse } from './parse-response.js';

describe('parseAxisResponse — happy path', () => {
  it('parses a single signal', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: -0.1, confidence: 0.85, excerpt: 'опять забил' },
      ],
    });
    const out = parseAxisResponse(raw);
    expect(out.signals).toHaveLength(1);
    expect(out.signals[0]).toEqual({
      axis: 'self_discipline',
      delta: -0.1,
      confidence: 0.85,
      excerpt: 'опять забил',
    });
  });
  it('parses multiple signals across axes', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: 0.05, confidence: 0.7 },
        { axis: 'emotional_openness', delta: 0.12, confidence: 0.9, excerpt: 'грустно' },
      ],
    });
    const out = parseAxisResponse(raw);
    expect(out.signals).toHaveLength(2);
  });
  it('strips markdown code fences', () => {
    const raw = '```json\n' +
      JSON.stringify({ signals: [{ axis: 'introspection_depth', delta: 0.1, confidence: 0.8 }] }) +
      '\n```';
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
  });
  it('strips plain markdown fences without json tag', () => {
    const raw = '```\n' + JSON.stringify({ signals: [] }) + '\n```';
    expect(parseAxisResponse(raw).signals).toEqual([]);
  });
});

describe('parseAxisResponse — malformed / fallback', () => {
  it('invalid JSON → empty signals', () => {
    expect(parseAxisResponse('not json').signals).toEqual([]);
  });
  it('empty string → empty signals', () => {
    expect(parseAxisResponse('').signals).toEqual([]);
  });
  it('missing signals key → empty', () => {
    expect(parseAxisResponse(JSON.stringify({ foo: 'bar' })).signals).toEqual([]);
  });
  it('signals as non-array → empty', () => {
    expect(parseAxisResponse(JSON.stringify({ signals: 'oops' })).signals).toEqual([]);
  });
  it('invalid axis name dropped', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'made_up_axis', delta: 0.1, confidence: 0.8 },
        { axis: 'self_discipline', delta: 0.1, confidence: 0.8 },
      ],
    });
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
    expect(parseAxisResponse(raw).signals[0].axis).toBe('self_discipline');
  });
  it('zero confidence filtered out (no-signal)', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: 0.1, confidence: 0 },
        { axis: 'emotional_openness', delta: 0.1, confidence: 0.5 },
      ],
    });
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
  });
  it('out-of-range delta clamped', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: -5, confidence: 0.8 }],
    });
    expect(parseAxisResponse(raw).signals[0].delta).toBe(-1);
  });
  it('out-of-range confidence clamped', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 2 }],
    });
    expect(parseAxisResponse(raw).signals[0].confidence).toBe(1);
  });
  it('excerpt truncated to 200 chars', () => {
    const long = 'а'.repeat(500);
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 0.8, excerpt: long }],
    });
    expect(parseAxisResponse(raw).signals[0].excerpt).toHaveLength(200);
  });
  it('non-string excerpt → undefined', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 0.8, excerpt: 12345 }],
    });
    expect(parseAxisResponse(raw).signals[0].excerpt).toBeUndefined();
  });
});
