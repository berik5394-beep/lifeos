import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateGoalProgressTool, pctFromValue } from './update-goal-progress.js';

describe('pctFromValue — конвертация в проценты', () => {
  it('абсолют 25 из 50 → 50%', () => {
    expect(pctFromValue(25, 50, false)).toBe(50);
  });
  it('valueIsPercent → как есть, кламп', () => {
    expect(pctFromValue(80, 50, true)).toBe(80);
    expect(pctFromValue(150, 50, true)).toBe(100);
  });
  it('target<=0 → 0', () => {
    expect(pctFromValue(25, 0, false)).toBe(0);
  });
  it('абсолют выше target → кламп 100', () => {
    expect(pctFromValue(60, 50, false)).toBe(100);
  });
});

describe('update-goal-progress — структура (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/tools/update-goal-progress.ts'), 'utf-8');
  it('резолв измеримой не-денежной цели + ветки 0/много без записи', () => {
    expect(SRC).toContain('isMoneyGoal');
    expect(SRC).toContain('year,');
    expect(SRC).toContain('target: { not: null }');
    expect(SRC).toContain('contains:');
    expect(SRC).toMatch(/length === 0/);
    expect(SRC).toMatch(/length > 1/);
  });
  it('пишет progress + captureActivity + реактив maybeGoalPaceLine', () => {
    expect(SRC).toContain('yearlyGoal.update');
    expect(SRC).toContain('captureActivity');
    expect(SRC).toContain('maybeGoalPaceLine');
  });
  it('зарегистрирован в реестре tools/index', () => {
    const IDX = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');
    expect(IDX).toContain('updateGoalProgressTool');
  });
  it('tool name', () => {
    expect(updateGoalProgressTool.name).toBe('update_goal_progress');
  });
});
