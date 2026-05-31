import { describe, it, expect } from 'vitest';
import {
  getEngagement,
  receptivenessScore,
  adaptiveThreshold,
  isReceptiveHour,
} from './index.js';

describe('engagement/index re-exports', () => {
  it('exposes getEngagement + the pure helpers', () => {
    expect(typeof getEngagement).toBe('function');
    expect(typeof receptivenessScore).toBe('function');
    expect(typeof adaptiveThreshold).toBe('function');
    expect(typeof isReceptiveHour).toBe('function');
  });
});
