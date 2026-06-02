import { describe, it, expect } from 'vitest';
import { computeSavingsPace } from './savings-pace.js';

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
