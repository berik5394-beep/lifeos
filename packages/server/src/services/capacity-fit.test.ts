import { describe, it, expect } from 'vitest';
import { computeCapacityFit } from './capacity-fit.js';

const item = (label: string, demand: number, importance: number) => ({ label, demand, importance });

describe('computeCapacityFit — ёмкость vs спрос', () => {
  it('пусто → fits, нули', () => {
    const r = computeCapacityFit({ capacity: 300, items: [] });
    expect(r.status).toBe('fits');
    expect(r.totalDemand).toBe(0);
    expect(r.overBy).toBe(0);
  });
  it('спрос много меньше ёмкости → fits', () => {
    const r = computeCapacityFit({ capacity: 1000, items: [item('a', 120, 3), item('b', 60, 2)] });
    expect(r.status).toBe('fits');
    expect(r.totalDemand).toBe(180);
  });
  it('впритык (0.85·cap ≤ demand ≤ cap) → tight', () => {
    const r = computeCapacityFit({ capacity: 300, items: [item('a', 270, 2)] });
    expect(r.status).toBe('tight');
  });
  it('перегруз → overloaded, overBy, greedy по importance', () => {
    const r = computeCapacityFit({
      capacity: 240,
      items: [item('low', 90, 1), item('hi', 120, 3), item('mid', 60, 2)],
    });
    expect(r.status).toBe('overloaded');
    expect(r.overBy).toBe(30); // 270 − 240
    expect(r.fit.map((i) => i.label)).toEqual(['hi', 'mid']); // важные защищены
    expect(r.overflow.map((i) => i.label)).toEqual(['low']);
  });
  it('capacity ≤ 0 → всё overflow, overloaded', () => {
    const r = computeCapacityFit({ capacity: 0, items: [item('a', 30, 1)] });
    expect(r.status).toBe('overloaded');
    expect(r.overflow).toHaveLength(1);
    expect(r.fit).toHaveLength(0);
  });
});
