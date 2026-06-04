import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('energy_link detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'energy_link'");
    expect(src).toContain('energy_link:');
    expect(src).toContain('async function detectEnergyLink');
    expect(src).toMatch(
      /async function detectEnergyLink[\s\S]*?isV2EnergyEnabled\(userId\)\)\s*return \[\]/,
    );
    expect(src).toMatch(/detectCandidates[\s\S]*?detectEnergyLink\(userId\)/);
  });
  it('TEMPLATES.energy_link имеет тон-варианты', () => {
    expect(TEMPLATES.energy_link?.gentle).toContain('{{goodAvg}}');
  });
  it('scoreSignificance: растёт с gap, капается на 0.85', () => {
    const mk = (gap: string) =>
      scoreSignificance({
        source: 'energy_link',
        significance: 0,
        payload: { gap, goodAvg: '80', poorAvg: '50' },
        toneHint: 'gentle',
      });
    expect(mk('25')).toBeCloseTo(0.5, 5);
    expect(mk('100')).toBe(0.85);
    expect(mk('0')).toBe(0);
  });
});
