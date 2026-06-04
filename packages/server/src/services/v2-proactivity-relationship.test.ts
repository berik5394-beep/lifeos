import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('relationship_link detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'relationship_link'");
    expect(src).toContain('relationship_link:');
    expect(src).toContain('async function detectRelationshipLink');
    expect(src).toMatch(
      /async function detectRelationshipLink[\s\S]*?isV2RelationshipsEnabled\(userId\)\)\s*return \[\]/,
    );
    expect(src).toMatch(/detectCandidates[\s\S]*?detectRelationshipLink\(userId\)/);
  });
  it('TEMPLATES.relationship_link имеет тон-варианты', () => {
    expect(TEMPLATES.relationship_link?.gentle).toContain('{{name}}');
  });
  it('scoreSignificance: растёт с daysSince×importance, капается на 0.85', () => {
    const mk = (daysSince: string, importance: string) =>
      scoreSignificance({
        source: 'relationship_link',
        significance: 0,
        payload: { daysSince, importance, name: 'X', description: 'y', days: daysSince },
        toneHint: 'gentle',
      });
    expect(mk('15', '10')).toBeCloseTo(0.5, 5);
    expect(mk('60', '10')).toBe(0.85);
    expect(mk('0', '10')).toBe(0);
  });
});
