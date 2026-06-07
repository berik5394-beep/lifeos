import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const TOOLS_INDEX = readFileSync(join(__dirname, '../tools/index.ts'), 'utf8');
const ASSIST = readFileSync(join(__dirname, 'assistant-service.ts'), 'utf8');

describe('monthly-goal wiring — всё связано (гард)', () => {
  it('monthly_goal_stall в union NudgeSource', () => {
    expect(ENGINE).toContain("| 'monthly_goal_stall'");
  });
  it('scoreSignificance обрабатывает monthly_goal_stall', () => {
    expect(ENGINE).toContain("case 'monthly_goal_stall':");
  });
  it('TEMPLATES имеет monthly_goal_stall', () => {
    expect(ENGINE).toContain('monthly_goal_stall: {');
  });
  it('детектор зарегистрирован в detectCandidates', () => {
    expect(ENGINE).toContain('detectMonthlyGoalStall(userId),');
  });
  it('детектор имеет ранний выход по daysUntilMonthEnd>5', () => {
    expect(ENGINE).toContain('if (daysLeft > 5) return [];');
  });
  it('детектор читает MonthlyGoal на localMonthOnlyUTC (SSOT)', () => {
    expect(ENGINE).toContain('localMonthOnlyUTC(tz)');
    expect(ENGINE).toContain('prisma.monthlyGoal.findMany');
  });
  it('роллап месяц↔неделя читает WeeklyGoal в окне месяца', () => {
    expect(ENGINE).toContain('weekStart: { gte: monthStart, lt: nextMonth }');
  });
  it('оба tool зарегистрированы', () => {
    expect(TOOLS_INDEX).toContain('createMonthlyGoalTool');
    expect(TOOLS_INDEX).toContain('getMonthlyPlanTool');
  });
  it('врезка monthlyPlan в gather-контексте', () => {
    expect(ASSIST).toContain('monthlyPlan');
    expect(ASSIST).toContain('prisma.monthlyGoal.findMany');
  });
});
