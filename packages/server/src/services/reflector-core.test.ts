import { describe, it, expect } from 'vitest';
import { reflect, type ReflectorFacts } from './reflector-core.js';
import type { GoalVerdict } from './plan-vs-fact.js';

/**
 * Phase 5 P3.b — инварианты ДЕТЕРМИНИСТСКОГО ядра рефлектора
 * (чистые функции, без БД/AI). Доказываем: какие кандидаты, severity,
 * source='reflector', и ЧЕСТНОСТЬ — нет фин-цели → нет выдуманного
 * горизонта.
 */

function verdict(p: Partial<GoalVerdict> = {}): GoalVerdict {
  return {
    area: 'finance',
    goalText: 'накопить на квартиру',
    progressPct: 10,
    expectedPct: 50,
    gap: 40,
    status: 'отстаёт',
    tooEarly: false,
    planStale: true,
    ...p,
  };
}

function facts(p: Partial<ReflectorFacts> = {}): ReflectorFacts {
  return {
    monthlyIncome: 500_000,
    monthlyBurn: 400_000,
    financeGoalTarget: null,
    financeGoalText: null,
    goalVerdicts: [],
    // Коуч-поля: pacingEnabled=false → эти тесты проверяют СТАРУЮ
    // горизонт-ветку (= поведение при флаге off, байт-в-байт).
    savedSoFar: 0,
    targetDate: new Date('2026-12-31T00:00:00Z'),
    pacingEnabled: false,
    now: new Date('2026-06-01T00:00:00Z'),
    financeGoals: [],
    ...p,
  };
}

describe('reflect — отрицательный денежный поток', () => {
  it('расход > доход → cashflow_negative severity 9, source reflector', () => {
    const r = reflect(facts({ monthlyIncome: 300_000, monthlyBurn: 400_000 }));
    const c = r.find((x) => x.kind === 'cashflow_negative');
    expect(c).toBeDefined();
    expect(c!.severity).toBe(9);
    expect(c!.source).toBe('reflector');
    expect(c!.scope).toBe('finance:cashflow');
  });
  it('сбережения положительны → нет cashflow_negative', () => {
    const r = reflect(facts({ monthlyIncome: 500_000, monthlyBurn: 400_000 }));
    expect(r.find((x) => x.kind === 'cashflow_negative')).toBeUndefined();
  });
});

describe('reflect — горизонт фин-цели (де-хардкод 35M)', () => {
  it('НЕТ фин-цели (target=null) → НЕ выдумываем горизонт (честность)', () => {
    const r = reflect(facts({ financeGoalTarget: null }));
    expect(
      r.find((x) => x.scope === 'finance:goal_horizon'),
    ).toBeUndefined();
  });
  it('цель есть, сбережения <=0 → goal_horizon_stalled', () => {
    const r = reflect(
      facts({
        monthlyIncome: 300_000,
        monthlyBurn: 300_000,
        financeGoalTarget: 35_000_000,
        financeGoalText: 'квартира',
      }),
    );
    const c = r.find((x) => x.kind === 'goal_horizon_stalled');
    expect(c).toBeDefined();
    expect(c!.severity).toBe(7);
  });
  it('цель есть, горизонт >=30 лет → goal_horizon_far с числом лет', () => {
    // 35M / (100k*12) ≈ 29.2 → возьмём меньше savings для >=30
    const r = reflect(
      facts({
        monthlyIncome: 200_000,
        monthlyBurn: 150_000, // savings 50k → 35M/600k ≈ 58 лет
        financeGoalTarget: 35_000_000,
        financeGoalText: 'квартира',
      }),
    );
    const c = r.find((x) => x.kind === 'goal_horizon_far');
    expect(c).toBeDefined();
    expect(c!.message).toMatch(/лет/);
  });
  it('цель достижима за разумный срок → нет инсайта горизонта', () => {
    const r = reflect(
      facts({
        monthlyIncome: 2_000_000,
        monthlyBurn: 500_000, // savings 1.5M → 35M/18M ≈ 1.9 лет
        financeGoalTarget: 35_000_000,
        financeGoalText: 'квартира',
      }),
    );
    expect(
      r.find((x) => x.scope === 'finance:goal_horizon'),
    ).toBeUndefined();
  });
});

describe('reflect — кросс-модуль: отстаёт И план устарел', () => {
  it('отстаёт + planStale → goal_behind_plan_stale', () => {
    const r = reflect(
      facts({ goalVerdicts: [verdict({ status: 'отстаёт', planStale: true })] }),
    );
    const c = r.find((x) => x.kind === 'goal_behind_plan_stale');
    expect(c).toBeDefined();
    expect(c!.scope).toBe('goal:finance');
    expect(c!.source).toBe('reflector');
  });
  it('отстаёт но план НЕ устарел → рефлектор молчит (плоское правило само)', () => {
    const r = reflect(
      facts({ goalVerdicts: [verdict({ status: 'отстаёт', planStale: false })] }),
    );
    expect(
      r.find((x) => x.kind === 'goal_behind_plan_stale'),
    ).toBeUndefined();
  });
  it('tooEarly (январь) → не эмитим', () => {
    const r = reflect(
      facts({
        goalVerdicts: [verdict({ tooEarly: true, planStale: true })],
      }),
    );
    expect(r).toHaveLength(0);
  });
});
