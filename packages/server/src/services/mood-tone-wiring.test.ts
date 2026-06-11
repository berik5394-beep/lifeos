import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suppressPressureNudges, PRESSURE_SOURCES, type NudgeCandidate } from './v2-proactivity-engine.js';

describe('mood-tone — Part 1 enrichment directive', () => {
  const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');
  it('флаг-гейт + директива при direction down', () => {
    expect(enr).toMatch(/isV2MoodToneEnabled\(/);
    expect(enr).toMatch(/moodToneDirective/);
    expect(enr).toMatch(/будь мягче/);
    expect(enr).toMatch(/перекрывает выбранный стиль/);
  });
});

describe('mood-tone — Part 2 suppressPressureNudges (pure)', () => {
  const mk = (source: NudgeCandidate['source']): NudgeCandidate =>
    ({ source, significance: 0.7, payload: {}, toneHint: 'gentle' }) as NudgeCandidate;
  const down = { shifted: true, direction: 'down' as const };
  it('down → pressure выкинут, поддержка/время-критичное остались', () => {
    const out = suppressPressureNudges([mk('goal_no_progress'), mk('mood_shift'), mk('person_meeting')], down);
    expect(out.map((c) => c.source)).toEqual(['mood_shift', 'person_meeting']);
  });
  it('up / null / not-shifted → нетронуто', () => {
    const cands = [mk('goal_no_progress')];
    expect(suppressPressureNudges(cands, { shifted: true, direction: 'up' })).toEqual(cands);
    expect(suppressPressureNudges(cands, null)).toEqual(cands);
    expect(suppressPressureNudges(cands, { shifted: false })).toEqual(cands);
  });
  it('PRESSURE_SOURCES не глушит поддержку (анти-регресс)', () => {
    for (const keep of ['mood_shift', 'person_meeting', 'obligation_due', 'runway_low', 'birthday_upcoming', 'commitment_due'] as const) {
      expect(PRESSURE_SOURCES.has(keep)).toBe(false);
    }
    expect(PRESSURE_SOURCES.size).toBe(10);
  });
});
describe('mood-tone — Part 2 wiring', () => {
  const eng = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf8');
  it('filterCandidates зовёт suppress за флагом', () => {
    expect(eng).toMatch(/isV2MoodToneEnabled\(/);
    expect(eng).toMatch(/suppressPressureNudges\(/);
  });
});
