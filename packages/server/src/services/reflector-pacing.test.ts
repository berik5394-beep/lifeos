import { describe, it, expect } from 'vitest';
import { reflect, type ReflectorFacts } from './reflector-core.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const base: ReflectorFacts = {
  monthlyIncome: 500_000,
  monthlyBurn: 300_000, // pace 200k/мес
  financeGoalTarget: 3_000_000,
  financeGoalText: 'накопить 3 млн',
  goalVerdicts: [],
  savedSoFar: 0,
  targetDate: new Date('2026-12-31T00:00:00Z'),
  pacingEnabled: true,
  now: NOW,
  financeGoals: [],
};

describe('reflect — pacing-ветка', () => {
  it('behind → инсайт scope finance:goal_pace с requiredMonthly', () => {
    const out = reflect(base);
    const pace = out.find((c) => c.scope === 'finance:goal_pace');
    expect(pace).toBeDefined();
    expect(pace!.kind).toBe('goal_pace_behind');
    expect(pace!.message).toMatch(/откладыва/i);
  });
  it('on_track (быстрый темп) → молчит про горизонт', () => {
    // pace 400k × 7 ≈ 2.8M > 1M цель
    const out = reflect({ ...base, monthlyBurn: 100_000, financeGoalTarget: 1_000_000 });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
  it('pacingEnabled=false → старый блок (нет scope finance:goal_pace)', () => {
    const out = reflect({ ...base, pacingEnabled: false });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
});
