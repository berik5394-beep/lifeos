import { describe, it, expect } from 'vitest';
import {
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
  BLOCKLIST,
  MAX_STEPS,
  SkillValidationError,
} from './types.js';

const KNOWN = new Set(['get-tasks', 'get-budget', 'add-expense', 'get-calendar']);
const CAT = (n: string): string =>
  n === 'add-expense' ? 'finance' : n.startsWith('get-') ? 'info' : 'system';

describe('validateSkillTools', () => {
  const ok = [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }];
  it('passes a valid read+write plan', () => {
    expect(() => validateSkillTools(ok, KNOWN, CAT)).not.toThrow();
  });
  it('rejects unknown tool', () => {
    expect(() => validateSkillTools([{ toolName: 'nope' }], KNOWN, CAT))
      .toThrow(SkillValidationError);
  });
  it('rejects empty plan', () => {
    expect(() => validateSkillTools([], KNOWN, CAT)).toThrow(SkillValidationError);
  });
  it('rejects > MAX_STEPS', () => {
    const big = Array.from({ length: MAX_STEPS + 1 }, () => ({ toolName: 'get-tasks' }));
    expect(() => validateSkillTools(big, KNOWN, CAT)).toThrow(SkillValidationError);
  });
  it('rejects a skill referencing another skill', () => {
    expect(() => validateSkillTools([{ toolName: 'skill_abc' }], KNOWN, CAT))
      .toThrow(SkillValidationError);
  });
  it('rejects a blocklisted category (pet)', () => {
    const known2 = new Set([...KNOWN, 'feed-pet']);
    const cat2 = (n: string): string => (n === 'feed-pet' ? 'pet' : CAT(n));
    expect(() => validateSkillTools([{ toolName: 'feed-pet' }], known2, cat2))
      .toThrow(SkillValidationError);
  });
});

describe('parseSkillSpec', () => {
  it('parses a valid spec', () => {
    const s = parseSkillSpec(JSON.stringify({
      name: 'Утренний брифинг', description: 'утром', triggers: ['брифинг'],
      plan: [{ toolName: 'get-tasks' }], synthesis: 'слей',
    }));
    expect(s?.name).toBe('Утренний брифинг');
    expect(s?.plan).toHaveLength(1);
  });
  it('strips markdown fences', () => {
    const s = parseSkillSpec('```json\n{"name":"X","description":"d",'
      + '"triggers":[],"plan":[{"toolName":"get-tasks"}],"synthesis":"s"}\n```');
    expect(s?.name).toBe('X');
  });
  it('returns null on garbage / missing fields', () => {
    expect(parseSkillSpec('not json')).toBeNull();
    expect(parseSkillSpec(JSON.stringify({ name: 'X' }))).toBeNull();
    expect(parseSkillSpec('')).toBeNull();
  });
});

describe('buildSkillInstruction', () => {
  it('renders plan + synthesis into an instruction string', () => {
    const out = buildSkillInstruction({
      name: 'Брифинг', description: 'd', triggers: [],
      plan: [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }],
      synthesis: 'Соедини задачи и бюджет.',
    } as any);
    expect(out).toContain('Брифинг');
    expect(out).toContain('get-tasks');
    expect(out).toContain('get-budget');
    expect(out).toContain('Соедини задачи и бюджет.');
    expect(out).toMatch(/подтвержд/i);
  });
});

describe('BLOCKLIST', () => {
  it('blocks pet category and photo_calorie', () => {
    expect(BLOCKLIST.categories.has('pet')).toBe(true);
    expect(BLOCKLIST.categories.has('photo_calorie')).toBe(true);
  });
});
