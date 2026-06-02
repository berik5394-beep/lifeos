import { describe, it, expect } from 'vitest';
import {
  computeSavingsPace,
  pickCoachableGoal,
  computePortfolioPace,
  describePortfolioPace,
} from './savings-pace.js';

describe('pickCoachableGoal — выбор фин-цели среди нескольких', () => {
  const d = (s: string) => new Date(s);
  it('пусто → null', () => {
    expect(pickCoachableGoal([])).toBeNull();
  });
  it('все достигнуты (saved>=target) → null (коучить нечего)', () => {
    expect(
      pickCoachableGoal([
        { target: 100000, targetDate: d('2026-06-30'), saved: 152598 },
      ]),
    ).toBeNull();
  });
  it('берёт НЕ достигнутую, даже если достигнутая ближе по сроку (живой баг)', () => {
    const r = pickCoachableGoal([
      { target: 100000, targetDate: d('2026-06-30'), saved: 152598 }, // достигнута, ближе
      { target: 800000, targetDate: d('2026-12-31'), saved: 152598 }, // отстаёт
    ]);
    expect(r?.target).toBe(800000);
  });
  it('из нескольких незакрытых — ближайший срок', () => {
    const r = pickCoachableGoal([
      { target: 800000, targetDate: d('2026-12-31'), saved: 0 },
      { target: 50000, targetDate: d('2026-07-15'), saved: 0 },
    ]);
    expect(r?.target).toBe(50000);
  });
});

const NOW = new Date('2026-06-01T00:00:00Z');
const DEC = new Date('2026-12-31T00:00:00Z'); // ~7 мес

describe('computeSavingsPace — статусы', () => {
  it('no_target при target<=0', () => {
    const r = computeSavingsPace({ target: 0, targetDate: DEC, savedSoFar: 0, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('no_target');
  });
  it('reached когда savedSoFar>=target', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: 1200, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('reached');
  });
  it('stalled когда monthlyPace<=0', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: 100, monthlyPace: 0, now: NOW });
    expect(r.status).toBe('stalled');
  });
  it('behind когда прогноз ниже цели + выдаёт requiredMonthly/paceGap', () => {
    // 3M цель, накоплено 0, темп 200k/мес × 7 мес = 1.4M < 3M
    const r = computeSavingsPace({ target: 3_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 200_000, now: NOW });
    expect(r.status).toBe('behind');
    expect(r.requiredMonthly).toBeGreaterThan(200_000); // надо больше текущего темпа
    expect(r.paceGap).toBeGreaterThan(0);
    expect(r.shortfall).toBeGreaterThan(0);
  });
  it('on_track когда прогноз достигает цели', () => {
    const r = computeSavingsPace({ target: 1_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 160_000, now: NOW });
    expect(['on_track', 'ahead']).toContain(r.status);
  });
  it('ahead когда прогноз >=110% цели', () => {
    const r = computeSavingsPace({ target: 1_000_000, targetDate: DEC, savedSoFar: 0, monthlyPace: 300_000, now: NOW });
    expect(r.status).toBe('ahead');
  });
});

describe('computeSavingsPace — границы (без NaN/Infinity)', () => {
  it('срок прошёл (monthsLeft=0, не добрал) → behind, requiredMonthly=remaining', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const r = computeSavingsPace({ target: 1000, targetDate: past, savedSoFar: 400, monthlyPace: 100, now: NOW });
    expect(r.status).toBe('behind');
    expect(r.monthsLeft).toBe(0);
    expect(r.requiredMonthly).toBe(600);
    expect(Number.isFinite(r.requiredMonthly)).toBe(true);
  });
  it('перерасход savedSoFar<0 — не падает', () => {
    const r = computeSavingsPace({ target: 1000, targetDate: DEC, savedSoFar: -200, monthlyPace: -50, now: NOW });
    expect(r.status).toBe('stalled');
    expect(Number.isFinite(r.progressPct)).toBe(true);
  });
});

describe('computePortfolioPace — портфель целей + якорь', () => {
  const PNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(PNOW.getTime() + n * MS);
  // saved=0, monthlyPace=capacity → required = target / monthsLeft.

  it('нет целей / все закрыты → none', () => {
    expect(computePortfolioPace({ goals: [], capacity: 100000, now: PNOW }).status).toBe('none');
    expect(
      computePortfolioPace({
        goals: [{ text: 'A', target: 1000, targetDate: inM(5), saved: 1000 }],
        capacity: 100000,
        now: PNOW,
      }).status,
    ).toBe('none');
  });

  it('capacity<=0 → stalled', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }],
      capacity: 0,
      now: PNOW,
    });
    expect(r.status).toBe('stalled');
  });

  it('capacity >= суммы нужного → on_track_all (молчим)', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
      capacity: 150_000, // >= 100k
      now: PNOW,
    });
    expect(r.status).toBe('on_track_all');
    expect(Math.round(r.sumRequired)).toBe(100_000);
  });

  it('capacity < нужного на главную → anchor_at_risk + anchorDelta', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }], // req 100k
      capacity: 40_000,
      now: PNOW,
    });
    expect(r.status).toBe('anchor_at_risk');
    expect(r.anchor?.goal.target).toBe(1_000_000);
    expect(Math.round(r.requiredAnchor)).toBe(100_000);
    expect(Math.round(r.anchorDelta)).toBe(60_000);
    expect(r.competitors).toEqual([]);
  });

  it('главную тянешь, мелкая сверху не лезет → collision + topCompetitor + collisionDelta', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 }, // req 50k (якорь)
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 }, // req 50k
      ],
      capacity: 60_000, // >= requiredAnchor(50k), < sumRequired(100k)
      now: PNOW,
    });
    expect(r.status).toBe('collision');
    expect(r.anchor?.goal.target).toBe(1_000_000);
    expect(r.topCompetitor?.goal.target).toBe(100_000);
    expect(Math.round(r.collisionDelta)).toBe(40_000);
  });

  it('якорь = самая денежная, даже если конкурент срочнее/требует больше', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(40), saved: 0 }, // req 25k
        { text: 'Срочное', target: 200_000, targetDate: inM(1), saved: 0 }, // req 200k
      ],
      capacity: 30_000,
      now: PNOW,
    });
    expect(r.anchor?.goal.target).toBe(1_000_000); // НЕ по срочности/required
    expect(r.topCompetitor?.goal.target).toBe(200_000);
  });

  it('одна цель → никогда collision', () => {
    const one = { text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }; // req 100k
    expect(computePortfolioPace({ goals: [one], capacity: 100_000, now: PNOW }).status).toBe('on_track_all');
    expect(computePortfolioPace({ goals: [one], capacity: 99_999, now: PNOW }).status).toBe('anchor_at_risk');
  });

  it('кейс Berik: квартира 800к + велик 100к, темп ~51к → anchor_at_risk', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 800_000, targetDate: inM(7), saved: 0 },
        { text: 'Велик', target: 100_000, targetDate: inM(1), saved: 0 },
      ],
      capacity: 50_866,
      now: PNOW,
    });
    expect(r.status).toBe('anchor_at_risk');
    expect(r.anchor?.goal.target).toBe(800_000);
    expect(r.anchorDelta).toBeGreaterThan(60_000);
  });
});

describe('describePortfolioPace — строка коуча', () => {
  const PNOW = new Date('2026-06-01T00:00:00Z');
  const MS = 30.44 * 86_400_000;
  const inM = (n: number) => new Date(PNOW.getTime() + n * MS);

  it('on_track_all / none → null (молчим)', () => {
    const ok = computePortfolioPace({
      goals: [{ text: 'A', target: 100_000, targetDate: inM(20), saved: 0 }],
      capacity: 999_999,
      now: PNOW,
    });
    expect(describePortfolioPace(ok)).toBeNull();
    expect(describePortfolioPace(computePortfolioPace({ goals: [], capacity: 1, now: PNOW }))).toBeNull();
  });

  it('anchor_at_risk → «надо +…₸/мес … опоздаешь» + имя главной', () => {
    const r = computePortfolioPace({
      goals: [{ text: 'Квартира', target: 1_000_000, targetDate: inM(10), saved: 0 }],
      capacity: 40_000,
      now: PNOW,
    });
    const s = describePortfolioPace(r)!;
    expect(s).toContain('Квартира');
    expect(s).toContain('опоздаешь');
    expect(s).toContain('60000');
  });

  it('collision → имя главной + конкурента + «двигаем»', () => {
    const r = computePortfolioPace({
      goals: [
        { text: 'Квартира', target: 1_000_000, targetDate: inM(20), saved: 0 },
        { text: 'Велик', target: 100_000, targetDate: inM(2), saved: 0 },
      ],
      capacity: 60_000,
      now: PNOW,
    });
    const s = describePortfolioPace(r)!;
    expect(s).toContain('Квартира');
    expect(s).toContain('Велик');
    expect(s).toContain('двигаем');
  });
});
