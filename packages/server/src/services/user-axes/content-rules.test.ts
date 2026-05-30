import { describe, it, expect } from 'vitest';
import {
  shouldForceOneStep,
  shouldSuppressEmotionalProbing,
  shouldSoftenChallenge,
  extractStepCount,
} from './content-rules.js';
import type { UserAxesValues } from './types.js';

const baseAxes: UserAxesValues = {
  selfDiscipline: 0.5,
  emotionalOpenness: 0.5,
  conflictTolerance: 0.5,
  introspectionDepth: 0.5,
  signalCount: 0,
  lastSignalAt: null,
};

describe('shouldForceOneStep (Gate 1)', () => {
  it('fires when selfDiscipline < 0.3 AND stepCount > 1', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.25 }, 3);
    expect(r.force).toBe(true);
    expect(r.reason).toContain('0.25');
  });
  it('does not fire when selfDiscipline >= 0.3', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.30 }, 5);
    expect(r.force).toBe(false);
  });
  it('does not fire when stepCount <= 1', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.1 }, 1);
    expect(r.force).toBe(false);
  });
});

describe('shouldSuppressEmotionalProbing (Gate 2)', () => {
  it('suppresses when EO < 0.3, no recent emotional content, 3+ msgs history', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.2 },
      3,
      false,
    )).toBe(true);
  });
  it('does not suppress when EO >= 0.3', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.3 },
      10,
      false,
    )).toBe(false);
  });
  it('does not suppress when emotional content recent (user opened door)', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.1 },
      10,
      true,
    )).toBe(false);
  });
  it('does not suppress at very first interactions (< 3 msgs)', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.1 },
      2,
      false,
    )).toBe(false);
  });
});

describe('shouldSoftenChallenge (Gate 3)', () => {
  it('softens when CT < 0.3 AND draft contains assertive challenge', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.2 },
      'Слушай, ты не прав. Это так не работает.',
    );
    expect(r.soften).toBe(true);
    expect(r.suggestedReframe).toContain('curious question');
  });
  it('does not soften when CT >= 0.3', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.4 },
      'Ты не прав.',
    );
    expect(r.soften).toBe(false);
  });
  it('does not soften neutral reply even when CT low', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.1 },
      'Понимаю что это сложно. Что тебе кажется проще?',
    );
    expect(r.soften).toBe(false);
  });
  it('matches multiple assertive patterns case-insensitively', () => {
    for (const phrase of ['ты не прав', 'это неправильно', 'перестань так делать', 'хватит']) {
      const r = shouldSoftenChallenge(
        { ...baseAxes, conflictTolerance: 0.1 },
        `${phrase}.`,
      );
      expect(r.soften).toBe(true);
    }
  });
});

describe('extractStepCount (helper for Gate 1)', () => {
  it('counts numbered list items', () => {
    expect(extractStepCount('1. Первое\n2. Второе\n3. Третье')).toBe(3);
  });
  it('counts Russian enumerators', () => {
    expect(extractStepCount('во-первых, ... во-вторых, ... в-третьих, ...')).toBeGreaterThanOrEqual(3);
  });
  it('returns 0 for prose without enumeration', () => {
    expect(extractStepCount('Понимаю что это важно для тебя.')).toBe(0);
  });
  it('returns 1 for single numbered item', () => {
    expect(extractStepCount('1. Одна привычка на неделю.')).toBe(1);
  });
  it('handles bullet lists', () => {
    expect(extractStepCount('- Первое\n- Второе\n- Третье\n- Четвёртое')).toBe(4);
  });
});
