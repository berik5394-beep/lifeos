import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reflector — проактивная ветка goal-pace (structural)', () => {
  const CORE = readFileSync(join(process.cwd(), 'src/services/reflector-core.ts'), 'utf-8');
  const SVC = readFileSync(join(process.cwd(), 'src/services/reflector-service.ts'), 'utf-8');
  it('reflect: ветка measurableGoals + describeGoalPace + source goal_pace', () => {
    expect(CORE).toContain('measurableGoals');
    expect(CORE).toContain('describeGoalPace');
    expect(CORE).toContain("source: 'goal_pace'");
  });
  it('reflect: гейт yearPacingEnabled + гард свежести monthsElapsed', () => {
    expect(CORE).toContain('yearPacingEnabled');
    expect(CORE).toContain('monthsElapsed');
  });
  it('gather: populate measurableGoals + yearPacingEnabled через isV2YearLoadEnabled', () => {
    expect(SVC).toContain('measurableGoals');
    expect(SVC).toContain('isV2YearLoadEnabled');
  });
});
