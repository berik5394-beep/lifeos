import { describe, it, expect } from 'vitest';
import {
  receptivenessScore,
  adaptiveThreshold,
  activeHourHistogram,
  isReceptiveHour,
} from './types.js';

describe('receptivenessScore', () => {
  it('no deliveries → neutral 0.5', () => {
    expect(receptivenessScore(0, 0, 0)).toBe(0.5);
  });
  it('all replied, none dismissed → high', () => {
    expect(receptivenessScore(10, 0, 10)).toBeGreaterThan(0.8);
  });
  it('all dismissed, none replied → low', () => {
    expect(receptivenessScore(10, 10, 0)).toBeLessThan(0.2);
  });
  it('clamped to [0,1]', () => {
    const s = receptivenessScore(5, 99, 0);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('adaptiveThreshold', () => {
  it('low receptiveness raises the bar', () => {
    expect(adaptiveThreshold(0.6, 0.0)).toBeGreaterThan(0.6);
  });
  it('high receptiveness lowers the bar', () => {
    expect(adaptiveThreshold(0.6, 1.0)).toBeLessThan(0.6);
  });
  it('neutral receptiveness ≈ base', () => {
    expect(adaptiveThreshold(0.6, 0.5)).toBeCloseTo(0.6, 5);
  });
  it('clamped to [base-0.15, base+0.25]', () => {
    expect(adaptiveThreshold(0.6, 0)).toBeLessThanOrEqual(0.6 + 0.25 + 1e-9);
    expect(adaptiveThreshold(0.6, 1)).toBeGreaterThanOrEqual(0.6 - 0.15 - 1e-9);
  });
});

describe('activeHourHistogram', () => {
  it('counts into 24 slots', () => {
    const h = activeHourHistogram([9, 9, 14, 23, 9]);
    expect(h).toHaveLength(24);
    expect(h[9]).toBe(3);
    expect(h[14]).toBe(1);
    expect(h[23]).toBe(1);
    expect(h[0]).toBe(0);
  });
  it('ignores out-of-range hours', () => {
    const h = activeHourHistogram([25, -1, 12]);
    expect(h[12]).toBe(1);
  });
});

describe('isReceptiveHour', () => {
  it('empty/sparse histogram → true (do not block when unknown)', () => {
    expect(isReceptiveHour([], 10)).toBe(true);
    expect(isReceptiveHour(activeHourHistogram([9, 10]), 3)).toBe(true);
  });
  it('hour with sufficient share → true', () => {
    const hours = Array.from({ length: 20 }, () => 9);
    expect(isReceptiveHour(activeHourHistogram(hours), 9)).toBe(true);
  });
  it('hour with negligible share → false', () => {
    const hours = Array.from({ length: 20 }, () => 9);
    expect(isReceptiveHour(activeHourHistogram(hours), 3)).toBe(false);
  });
});
