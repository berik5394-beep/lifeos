import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSignificance, TEMPLATES } from './v2-proactivity-engine.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('runway_low detector wiring', () => {
  it('источник + шаблон + детектор + ранний флаг-гейт + регистрация', () => {
    expect(src).toContain("'runway_low'");
    expect(src).toContain('runway_low:');
    expect(src).toContain('async function detectRunwayLow');
    expect(src).toMatch(
      /async function detectRunwayLow[\s\S]*?isV2RunwayEnabled\(userId\)\)\s*return \[\]/,
    );
    expect(src).toMatch(/detectCandidates[\s\S]*?detectRunwayLow\(userId\)/);
  });
  it('TEMPLATES.runway_low имеет тон-варианты', () => {
    expect(TEMPLATES.runway_low?.gentle).toContain('{{months}}');
  });
  it('scoreSignificance: critical>underwater>short', () => {
    const mk = (status: string) =>
      scoreSignificance({
        source: 'runway_low',
        significance: 0,
        payload: { status, months: '1', cash: '0' },
        toneHint: 'gentle',
      });
    expect(mk('critical')).toBe(0.9);
    expect(mk('underwater')).toBe(0.8);
    expect(mk('short')).toBe(0.7);
  });
});
