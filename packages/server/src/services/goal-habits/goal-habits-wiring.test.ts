import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ENGINE = readFileSync(join(__dirname, '..', 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, '..', 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '..', '..', 'lib', 'feature-flags.ts'), 'utf8');
const CH = readFileSync(join(__dirname, '..', '..', 'tools', 'complete-habit.ts'), 'utf8');
const HEALTH = readFileSync(join(__dirname, 'health.ts'), 'utf8');

describe('goal-habits wiring (structural)', () => {
  it('флаг isV2GoalHabitsEnabled', () => {
    expect(FLAGS).toMatch(/export function isV2GoalHabitsEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_GOAL_HABITS/);
  });
  it('goal_habits_stall в engine union+TEMPLATES+score+detectCandidates', () => {
    expect(ENGINE).toMatch(/'goal_habits_stall'/);
    expect(ENGINE).toMatch(/goal_habits_stall:\s*{/);
    expect(ENGINE).toMatch(/case 'goal_habits_stall':/);
    expect(ENGINE).toMatch(/detectGoalHabitStall\(userId\)/);
  });
  it('detectGoalHabitStall ранний флаг-гейт', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('async function detectGoalHabitStall'));
    expect(fn).toMatch(/if\s*\(!isV2GoalHabitsEnabled\(userId\)\)\s*return\s*\[\]/);
  });
  it('ЧЕСТНОСТЬ: complete-habit.ts бросает на промахе, нет тихого notFound-return', () => {
    expect(CH).toMatch(/throw new Error\(buildNotFoundMessage/);
    expect(CH).not.toMatch(/return\s*{\s*message:\s*'Привычка не найдена'/);
  });
  it('enrichment врезка goalHabits за флагом', () => {
    expect(ENRICH).toMatch(/goalHabits:\s*string\s*\|\s*null/);
    expect(ENRICH).toMatch(/isV2GoalHabitsEnabled\(userId\)/);
    expect(ENRICH).toMatch(/if\s*\(gh\)/);
  });
  it('money-safety: health.ts (goal-habits) без prisma write', () => {
    expect(HEALTH).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany|createMany)/);
  });
});
