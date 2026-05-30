import { describe, it, expect } from 'vitest';
import {
  clampDelta,
  clampConfidence,
  axisLabel,
  applyEwma,
  AXIS_DEFAULTS,
  AXIS_NAMES,
} from './types.js';

describe('clampDelta', () => {
  it('clamps to [-1, 1]', () => {
    expect(clampDelta(0)).toBe(0);
    expect(clampDelta(0.5)).toBe(0.5);
    expect(clampDelta(-0.5)).toBe(-0.5);
    expect(clampDelta(1.5)).toBe(1);
    expect(clampDelta(-2)).toBe(-1);
    expect(clampDelta(1)).toBe(1);
    expect(clampDelta(-1)).toBe(-1);
  });
  it('NaN → 0', () => {
    expect(clampDelta(NaN)).toBe(0);
  });
});

describe('clampConfidence', () => {
  it('clamps to [0, 1]', () => {
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(1)).toBe(1);
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-0.3)).toBe(0);
  });
  it('NaN → 0', () => {
    expect(clampConfidence(NaN)).toBe(0);
  });
});

describe('axisLabel', () => {
  it('returns expected Russian labels for value ranges', () => {
    expect(axisLabel(0.0)).toBe('очень низкая');
    expect(axisLabel(0.15)).toBe('очень низкая');
    expect(axisLabel(0.2)).toBe('низкая');
    expect(axisLabel(0.35)).toBe('низкая');
    expect(axisLabel(0.4)).toBe('средняя');
    expect(axisLabel(0.5)).toBe('средняя');
    expect(axisLabel(0.6)).toBe('средняя');
    expect(axisLabel(0.7)).toBe('высокая');
    expect(axisLabel(0.8)).toBe('высокая');
    expect(axisLabel(0.85)).toBe('очень высокая');
    expect(axisLabel(1.0)).toBe('очень высокая');
  });
});

describe('applyEwma', () => {
  it('returns current value when delta=0', () => {
    expect(applyEwma(0.5, 0, 1.0)).toBe(0.5);
  });
  it('moves toward target with α=0.05 by default', () => {
    const next = applyEwma(0.5, -0.1, 1.0);
    // target = clamp01(0.5 + -0.1*1.0) = 0.4
    // next = 0.05 * 0.4 + 0.95 * 0.5 = 0.495
    expect(next).toBeCloseTo(0.495, 3);
  });
  it('clamps target to [0, 1] before EWMA', () => {
    const next = applyEwma(0.95, 0.5, 1.0); // target would be 1.45 → clamp 1
    // next = 0.05 * 1 + 0.95 * 0.95 = 0.9525
    expect(next).toBeCloseTo(0.9525, 3);
  });
  it('confidence scales weighted delta', () => {
    const next = applyEwma(0.5, -0.2, 0.5); // weighted = -0.1
    expect(next).toBeCloseTo(0.495, 3);
  });
  it('accepts custom alpha', () => {
    const next = applyEwma(0.5, -0.1, 1.0, 0.5);
    // target = 0.4, next = 0.5 * 0.4 + 0.5 * 0.5 = 0.45
    expect(next).toBeCloseTo(0.45, 3);
  });
  it('asymptotic: 100 strong DOWN signals do not hit 0', () => {
    let v = 0.5;
    for (let i = 0; i < 100; i++) v = applyEwma(v, -1, 1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.01);
  });
});

describe('AXIS_DEFAULTS + AXIS_NAMES', () => {
  it('AXIS_NAMES has exactly 4 entries', () => {
    expect(AXIS_NAMES).toHaveLength(4);
    expect(AXIS_NAMES).toEqual([
      'self_discipline',
      'emotional_openness',
      'conflict_tolerance',
      'introspection_depth',
    ]);
  });
  it('AXIS_DEFAULTS has 0.5 for each axis', () => {
    AXIS_NAMES.forEach((axis) => {
      expect(AXIS_DEFAULTS[axis]).toBe(0.5);
    });
  });
});
