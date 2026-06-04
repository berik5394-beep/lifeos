import { describe, it, expect } from 'vitest';
import { pairDays, bucketContrast, describeEnergyLink } from './types.js';

describe('energy-link/types', () => {
  it('pairDays: пара только для общих дат', () => {
    const journal = { '2026-06-01': 8, '2026-06-02': 5, '2026-06-03': 7 };
    const completion = { '2026-06-01': 90, '2026-06-02': 40 };
    const pairs = pairDays(journal, completion);
    expect(pairs).toEqual([
      { sleepHours: 8, completionPct: 90 },
      { sleepHours: 5, completionPct: 40 },
    ]);
  });

  it('bucketContrast: link при достаточных данных и разрыве ≥15', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 7.5, completionPct: 76 },
      { sleepHours: 7, completionPct: 78 },
      { sleepHours: 9, completionPct: 82 },
      { sleepHours: 5, completionPct: 50 },
      { sleepHours: 6, completionPct: 54 },
      { sleepHours: 4, completionPct: 48 },
      { sleepHours: 6.5, completionPct: 52 },
    ];
    const c = bucketContrast(pairs);
    expect(c.status).toBe('link');
    expect(c.goodN).toBe(4);
    expect(c.poorN).toBe(4);
    expect(c.goodAvg).toBe(79);
    expect(c.poorAvg).toBe(51);
    expect(c.gapPct).toBe(28);
  });

  it('bucketContrast: insufficient при <4 в бакете', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 5, completionPct: 40 },
    ];
    const c = bucketContrast(pairs);
    expect(c.status).toBe('insufficient');
    expect(c.goodAvg).toBeNull();
    expect(c.gapPct).toBeNull();
  });

  it('bucketContrast: weak при разрыве <15', () => {
    const pairs = [
      { sleepHours: 8, completionPct: 70 },
      { sleepHours: 7, completionPct: 72 },
      { sleepHours: 7.5, completionPct: 68 },
      { sleepHours: 9, completionPct: 74 },
      { sleepHours: 5, completionPct: 65 },
      { sleepHours: 6, completionPct: 63 },
      { sleepHours: 4, completionPct: 67 },
      { sleepHours: 6.5, completionPct: 61 },
    ];
    expect(bucketContrast(pairs).status).toBe('weak');
  });

  it('describeEnergyLink: строка только для link+gap>0', () => {
    const link = bucketContrast([
      { sleepHours: 8, completionPct: 80 },
      { sleepHours: 7.5, completionPct: 76 },
      { sleepHours: 7, completionPct: 78 },
      { sleepHours: 9, completionPct: 82 },
      { sleepHours: 5, completionPct: 50 },
      { sleepHours: 6, completionPct: 54 },
      { sleepHours: 4, completionPct: 48 },
      { sleepHours: 6.5, completionPct: 52 },
    ]);
    const s = describeEnergyLink(link);
    expect(s).toContain('79%');
    expect(s).toContain('51%');
    expect(s).toContain('≥7ч');
  });

  it('describeEnergyLink: null для insufficient и для gap<0 (парадокс)', () => {
    const insuf = bucketContrast([{ sleepHours: 8, completionPct: 80 }]);
    expect(describeEnergyLink(insuf)).toBeNull();
    const paradox = bucketContrast([
      { sleepHours: 8, completionPct: 50 },
      { sleepHours: 7.5, completionPct: 52 },
      { sleepHours: 7, completionPct: 48 },
      { sleepHours: 9, completionPct: 50 },
      { sleepHours: 5, completionPct: 80 },
      { sleepHours: 6, completionPct: 78 },
      { sleepHours: 4, completionPct: 82 },
      { sleepHours: 6.5, completionPct: 80 },
    ]);
    expect(paradox.status).toBe('link');
    expect(paradox.gapPct).toBeLessThan(0);
    expect(describeEnergyLink(paradox)).toBeNull();
  });
});
