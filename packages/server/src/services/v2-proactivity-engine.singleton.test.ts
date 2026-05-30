import { describe, it, expect } from 'vitest';
import {
  getProactivityEngine,
  _resetProactivityEngineForTests,
} from './v2-proactivity-engine.singleton.js';
import { V2ProactivityEngine } from './v2-proactivity-engine.js';

describe('proactivity-engine singleton', () => {
  it('returns the same instance across calls', () => {
    _resetProactivityEngineForTests();
    const a = getProactivityEngine();
    const b = getProactivityEngine();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(V2ProactivityEngine);
  });
  it('reset replaces the instance', () => {
    const a = getProactivityEngine();
    _resetProactivityEngineForTests();
    const b = getProactivityEngine();
    expect(a).not.toBe(b);
  });
});
