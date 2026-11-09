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
    // Коуч-поля (pacing портфеля фин-целей — всегда; financeGoals пуст →
    // pacing-блок молчит, тесты ниже про остальные правила).
    savedSoFar: 0,
    targetDate: new Date('2026-12-31T00:00:00Z'),
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

describe('reflect — старый горизонт-блок «≥30 лет» удалён (флаг коуча на проде all)', () => {
  it('одиночная фин-цель без массива financeGoals → finance:goal_horizon не появляется', () => {
    const r = reflect(
      facts({
        monthlyIncome: 200_000,
        monthlyBurn: 150_000,
        financeGoalTarget: 35_000_000,
        financeGoalText: 'квартира',
      }),
    );
    expect(r.find((x) => x.scope === 'finance:goal_horizon')).toBeUndefined();
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

describe('reflect — portfolio pacing (флаг on)', () => {
  const RNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(RNOW.getTime() + n * MS);
  const pbase: ReflectorFacts = {
    monthlyIncome: 100_000,
    monthlyBurn: 0,
    financeGoalTarget: null,
    financeGoalText: null,
    goalVerdicts: [],
    savedSoFar: 0,
    targetDate: inM(12),
    now: RNOW,
    financeGoals: [],
  };

  it('anchor_at_risk → инсайт finance:goal_pace с «опоздаешь»', () => {
    const out = reflect({
      ...pbase,
      monthlyIncome: 40_000, // темп 40k
      financeGoals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }, // req 100k
      ],
    });
    const ins = out.find((c) => c.scope === 'finance:goal_pace');
    expect(ins).toBeTruthy();
    expect(ins!.kind).toBe('goal_pace_behind');
    expect(ins!.message).toContain('опоздаешь');
  });

  it('collision → kind goal_pace_collision', () => {
    const out = reflect({
      ...pbase,
      monthlyIncome: 60_000,
      financeGoals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
    });
    const ins = out.find((c) => c.scope === 'finance:goal_pace');
    expect(ins?.kind).toBe('goal_pace_collision');
  });

  it('on_track_all → молчит (нет finance:goal_pace)', () => {
    const out = reflect({
      ...pbase,
      monthlyIncome: 500_000,
      financeGoals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 },
      ],
    });
    expect(out.find((c) => c.scope === 'finance:goal_pace')).toBeUndefined();
  });

});
