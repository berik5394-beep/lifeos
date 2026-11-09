import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reflector — проактивная ветка goal-pace (structural)', () => {
  const CORE = readFileSync(join(process.cwd(), 'src/services/reflector-core.ts'), 'utf-8');
  const SVC = readFileSync(join(process.cwd(), 'src/services/reflector-service.ts'), 'utf-8');
  it('reflect: ветка measurableGoals + describeGoalPace + scope goal:pace', () => {
    expect(CORE).toContain('measurableGoals');
    expect(CORE).toContain('describeGoalPace');
    expect(CORE).toContain("scope: 'goal:pace:' + g.id");
    // проактив использует source 'reflector' (НЕ 'goal_pace') — чтобы не
    // глушить реактивную строку в тот же день.
    expect(CORE).not.toMatch(/goal pace[\s\S]*?source: 'goal_pace'/);
  });
  it('reflect: без флага (yearPacingEnabled удалён) + гард свежести monthsElapsed', () => {
    expect(CORE).not.toContain('yearPacingEnabled');
    expect(CORE).toContain('monthsElapsed');
  });
  it('gather: populate measurableGoals (isV2YearLoadEnabled удалён)', () => {
    expect(SVC).toContain('measurableGoals');
    expect(SVC).not.toContain('isV2YearLoadEnabled');
  });
});
