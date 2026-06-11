import { describe, it, expect } from 'vitest';
import { recencyFactor, entityDecayScore, ENTITY_HALFLIFE_DAYS } from './memory-decay.js';

describe('recencyFactor', () => {
  it('1.0 на 0 дней', () => { expect(recencyFactor(0, 45)).toBeCloseTo(1, 6); });
  it('0.5 на halflife', () => { expect(recencyFactor(45, 45)).toBeCloseTo(0.5, 6); });
  it('убывает с возрастом', () => { expect(recencyFactor(180, 45)).toBeLessThan(recencyFactor(45, 45)); });
  it('клампит отрицательное к 0 (→1.0)', () => { expect(recencyFactor(-10, 45)).toBeCloseTo(1, 6); });
});
describe('entityDecayScore', () => {
  const NOW = new Date('2026-06-11T00:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
  it('мама imp9 @40д > Камила imp5 @180д', () => {
    const mama = entityDecayScore(9, daysAgo(40), NOW);
    const kamila = entityDecayScore(5, daysAgo(180), NOW);
    expect(mama).toBeGreaterThan(kamila);
    expect(kamila).toBeLessThan(1);
  });
  it('свежий imp4 @5д остаётся высоким', () => { expect(entityDecayScore(4, daysAgo(5), NOW)).toBeGreaterThan(3); });
  it('null lastSeenAt → очень низкий (трактуем как древнее)', () => { expect(entityDecayScore(5, null, NOW)).toBeLessThan(0.1); });
  it('ENTITY_HALFLIFE_DAYS = 45', () => { expect(ENTITY_HALFLIFE_DAYS).toBe(45); });
});
