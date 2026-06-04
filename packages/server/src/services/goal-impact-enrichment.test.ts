import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatGoalImpactSection,
  buildV2EnrichmentBlock,
} from './v2-enrichment.js';

const src = readFileSync(
  join(process.cwd(), 'src/services/v2-enrichment.ts'),
  'utf-8',
);

describe('goal-impact enrichment врезка', () => {
  it('флаг-гейт + buildGoalImpact + рендер за форматтером', () => {
    expect(src).toContain('isV2GoalImpactEnabled');
    expect(src).toContain('buildGoalImpact');
    expect(src).toContain('formatGoalImpactSection');
  });

  it('formatGoalImpactSection: null → пусто; текст → строка с инсайтом', () => {
    expect(formatGoalImpactSection(null)).toBe('');
    const s = formatGoalImpactSection('🎯 «миллион»: нужно ~100000₸/мес.');
    expect(s).toContain('Влияние на цель');
    expect(s).toContain('миллион');
  });

  it('buildV2EnrichmentBlock включает goalImpact когда он есть', () => {
    const block = buildV2EnrichmentBlock({
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: '🎯 «миллион»: нужно ~100000₸/мес.',
    });
    expect(block).toContain('Влияние на цель');
    // null goalImpact → блок без секции (off=байт-идентично)
    const blockOff = buildV2EnrichmentBlock({
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
    });
    expect(blockOff).not.toContain('Влияние на цель');
  });
});
