import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatRunwaySection, buildV2EnrichmentBlock } from './v2-enrichment.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');

describe('runway enrichment врезка', () => {
  it('флаг-гейт + buildRunway + рендер', () => {
    expect(src).toContain('isV2RunwayEnabled');
    expect(src).toContain('buildRunway');
    expect(src).toContain('formatRunwaySection');
  });
  it('formatRunwaySection: null → пусто; текст → строка', () => {
    expect(formatRunwaySection(null)).toBe('');
    expect(formatRunwaySection('хватит на 2 мес')).toContain('Запас денег');
  });
  it('buildV2EnrichmentBlock включает runway когда он есть; off → нет', () => {
    const base = {
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
    };
    expect(buildV2EnrichmentBlock({ ...base, runway: 'хватит на 2 мес' })).toContain('Запас денег');
    expect(buildV2EnrichmentBlock({ ...base, runway: null })).not.toContain('Запас денег');
  });
});
