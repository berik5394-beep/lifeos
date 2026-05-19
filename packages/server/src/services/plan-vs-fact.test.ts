import { describe, it, expect } from 'vitest';
import {
  planVsFact,
  yearElapsedPct,
  yearElapsedFraction,
  type GoalFact,
} from './plan-vs-fact.js';

/**
 * Phase 5 R4 — инварианты ЕДИНОЙ границы план↔факт (чистые функции,
 * без БД). Доказываем формулу ОДИН раз, чтобы get_goal_progress,
 * proactive-insights и рефлектор не дрейфовали (класс W4).
 */

const DAY = 86_400_000;

function goal(p: Partial<GoalFact> = {}): GoalFact {
  return {
    area: 'finance',
    goalText: 'накопить миллион',
    progress: 0.2,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    planBuiltAt: null,
    planWeeks: 0,
    ...p,
  };
}

describe('yearElapsed* — темп года', () => {
  it('середина года ≈ 50%', () => {
    const mid = new Date('2026-07-02T12:00:00');
    expect(yearElapsedPct(mid)).toBe(50);
    expect(yearElapsedFraction(mid)).toBeCloseTo(0.5, 1);
  });
  it('1 января ≈ 0%', () => {
    expect(yearElapsedPct(new Date('2026-01-01T06:00:00'))).toBe(0);
  });
});

describe('planVsFact — нормализация progress (0..1 ИЛИ 0..100)', () => {
  const now = new Date('2026-07-02T12:00:00'); // ~50%
  it('progress 0..1 → процент', () => {
    const r = planVsFact([goal({ progress: 0.4 })], now);
    expect(r.goals[0].progressPct).toBe(40);
  });
  it('progress 0..100 → как есть', () => {
    const r = planVsFact([goal({ progress: 40 })], now);
    expect(r.goals[0].progressPct).toBe(40);
  });
});

describe('planVsFact — status (отстаёт / в графике / с опережением)', () => {
  const now = new Date('2026-07-02T12:00:00'); // expected ≈ 50
  it('gap >= 25 → отстаёт', () => {
    const r = planVsFact([goal({ progress: 0.2 })], now); // gap 30
    expect(r.goals[0].status).toBe('отстаёт');
    expect(r.goals[0].gap).toBe(30);
  });
  it('|gap| мал → в графике', () => {
    const r = planVsFact([goal({ progress: 0.45 })], now); // gap 5
    expect(r.goals[0].status).toBe('в графике');
  });
  it('gap <= -10 → с опережением', () => {
    const r = planVsFact([goal({ progress: 0.7 })], now); // gap -20
    expect(r.goals[0].status).toBe('с опережением');
  });
});

describe('planVsFact — tooEarly (январь: рано судить)', () => {
  it('elapsed < 15% → tooEarly=true (и на уровне цели тоже)', () => {
    const jan = new Date('2026-01-10T00:00:00'); // ~2.5%
    const r = planVsFact([goal({ progress: 0 })], jan);
    expect(r.tooEarly).toBe(true);
    expect(r.goals[0].tooEarly).toBe(true);
    // status всё равно считается (get_goal_progress показывает факт);
    // эмиссию инсайта гейтит call-site по tooEarly.
    expect(r.goals[0].status).toBe('в графике'); // gap≈2 < 25
  });
  it('после 15% → tooEarly=false', () => {
    expect(planVsFact([goal()], new Date('2026-06-01')).tooEarly).toBe(false);
  });
});

describe('planVsFact — planStale (честный boolean, не догадка)', () => {
  const now = new Date('2026-07-02T12:00:00');
  it('плана нет (planWeeks=0) → planStale=false', () => {
    const r = planVsFact([goal({ planWeeks: 0, planBuiltAt: null })], now);
    expect(r.goals[0].planStale).toBe(false);
  });
  it('цель менялась ПОСЛЕ постройки (+буфер) → stale', () => {
    const built = new Date('2026-03-01T00:00:00Z');
    const r = planVsFact(
      [
        goal({
          planWeeks: 4,
          planBuiltAt: built,
          updatedAt: new Date(built.getTime() + 5 * DAY),
        }),
      ],
      now,
    );
    expect(r.goals[0].planStale).toBe(true);
  });
  it('updatedAt в пределах 60с буфера → НЕ stale (ms-джиттер транзакции)', () => {
    const built = new Date('2026-03-01T00:00:00Z');
    const r = planVsFact(
      [
        goal({
          planWeeks: 4,
          planBuiltAt: built,
          updatedAt: new Date(built.getTime() + 30_000),
        }),
      ],
      now,
    );
    expect(r.goals[0].planStale).toBe(false);
  });
});
