import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(
  join(process.cwd(), 'src/services/v2-proactivity-engine.ts'),
  'utf-8',
);

describe('goal_impact detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'goal_impact'");
    expect(src).toContain('goal_impact:'); // TEMPLATES + scoreSignificance case
    expect(src).toContain('async function detectGoalImpact');
    // ранний флаг-return внутри detectGoalImpact (off=байт-идентично)
    expect(src).toMatch(
      /async function detectGoalImpact[\s\S]*?isV2GoalImpactEnabled\(userId\)\)\s*return \[\]/,
    );
    // зарегистрирован в Promise.allSettled
    expect(src).toMatch(/detectCandidates[\s\S]*?detectGoalImpact\(userId\)/);
  });

  it('TEMPLATES.goal_impact имеет тон-варианты', () => {
    expect(TEMPLATES.goal_impact?.gentle).toBeTruthy();
    expect(TEMPLATES.goal_impact?.gentle).toContain('{{category}}');
    expect(TEMPLATES.goal_impact?.gentle).toContain('{{goal}}');
  });

  it('scoreSignificance: share 25% → ~0.5; 50%+ → 1', () => {
    const mk = (share: string) =>
      scoreSignificance({
        source: 'goal_impact',
        significance: 0,
        payload: { share, goal: 'миллион', category: 'food' },
        toneHint: 'gentle',
      });
    expect(mk('25')).toBeCloseTo(0.5, 2);
    expect(mk('50')).toBe(1);
    expect(mk('0')).toBe(0);
  });
});
