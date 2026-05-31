import { describe, it, expect } from 'vitest';
import { runSkillPlan, resolveSkillArgs, partitionSteps } from './index.js';

describe('hermes/index H2 re-exports', () => {
  it('exposes runSkillPlan, resolveSkillArgs, partitionSteps', () => {
    expect(typeof runSkillPlan).toBe('function');
    expect(typeof resolveSkillArgs).toBe('function');
    expect(typeof partitionSteps).toBe('function');
  });
});
