import { describe, it, expect } from 'vitest';
import {
  getHermesStore,
  _resetHermesForTests,
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
  routeToSkill,
  buildSkillFromRequest,
} from './index.js';

describe('hermes/index', () => {
  it('getHermesStore returns a stable singleton', () => {
    _resetHermesForTests();
    const a = getHermesStore();
    const b = getHermesStore();
    expect(a).toBe(b);
    expect(typeof a.createSkill).toBe('function');
    expect(typeof a.activeSkills).toBe('function');
  });
  it('reset yields a fresh instance', () => {
    const a = getHermesStore();
    _resetHermesForTests();
    expect(getHermesStore()).not.toBe(a);
  });
  it('re-exports the public surface', () => {
    expect(typeof validateSkillTools).toBe('function');
    expect(typeof parseSkillSpec).toBe('function');
    expect(typeof buildSkillInstruction).toBe('function');
    expect(typeof routeToSkill).toBe('function');
    expect(typeof buildSkillFromRequest).toBe('function');
  });
});
