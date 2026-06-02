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
  financeGoals: [
    {
      text: 'накопить 3 млн',
      target: 3_000_000,
      targetDate: new Date('2026-12-31T00:00:00Z'),
      saved: 0,
    },
  ],
};

describe('reflect — pacing-ветка', () => {
  it('behind → инсайт scope finance:goal_pace (anchor_at_risk → опоздаешь)', () => {
    const out = reflect(base);
    const pace = out.find((c) => c.scope === 'finance:goal_pace');
    expect(pace).toBeDefined();
    expect(pace!.kind).toBe('goal_pace_behind');
    expect(pace!.message).toMatch(/опоздаешь/);
  });
  it('on_track (быстрый темп) → молчит про горизонт', () => {
    // capacity 400k × 7 ≈ 2.8M > 1M цель → on_track_all
    const out = reflect({
      ...base,
      monthlyBurn: 100_000,
      financeGoals: [
        {
          text: 'накопить 1 млн',
          target: 1_000_000,
          targetDate: new Date('2026-12-31T00:00:00Z'),
          saved: 0,
        },
      ],
    });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
  it('pacingEnabled=false → старый блок (нет scope finance:goal_pace)', () => {
    const out = reflect({ ...base, pacingEnabled: false });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });
});
