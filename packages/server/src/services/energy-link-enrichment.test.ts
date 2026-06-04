import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatEnergyLinkSection, buildV2EnrichmentBlock } from './v2-enrichment.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');

describe('energy-link enrichment врезка', () => {
  it('флаг-гейт + buildEnergyLink + рендер', () => {
    expect(src).toContain('isV2EnergyEnabled');
    expect(src).toContain('buildEnergyLink');
    expect(src).toContain('formatEnergyLinkSection');
  });
  it('formatEnergyLinkSection: null → пусто; текст → строка', () => {
    expect(formatEnergyLinkSection(null)).toBe('');
    expect(formatEnergyLinkSection('сон двигает')).toContain('Сон и продуктивность');
  });
  it('buildV2EnrichmentBlock включает energyLink когда он есть; off → нет', () => {
    const base = {
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
      runway: null,
    };
    expect(buildV2EnrichmentBlock({ ...base, energyLink: 'сон двигает' })).toContain('Сон и продуктивность');
    expect(buildV2EnrichmentBlock({ ...base, energyLink: null })).not.toContain('Сон и продуктивность');
  });
});
