import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatRelationshipSection, buildV2EnrichmentBlock } from './v2-enrichment.js';

const src = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');

describe('relationship-link enrichment врезка', () => {
  it('флаг-гейт + buildRelationshipNudge + рендер', () => {
    expect(src).toContain('isV2RelationshipsEnabled');
    expect(src).toContain('buildRelationshipNudge');
    expect(src).toContain('formatRelationshipSection');
  });
  it('formatRelationshipSection: null → пусто; текст → строка', () => {
    expect(formatRelationshipSection(null)).toBe('');
    expect(formatRelationshipSection('не общались с X')).toContain('Отношения');
  });
  it('buildV2EnrichmentBlock включает relationship когда есть; off → нет', () => {
    const base = {
      identity: null,
      patterns: [],
      moodShift: null,
      entities: [],
      obligations: [],
      goalImpact: null,
      runway: null,
      energyLink: null,
    };
    expect(buildV2EnrichmentBlock({ ...base, relationship: 'не общались с X' })).toContain('Отношения');
    expect(buildV2EnrichmentBlock({ ...base, relationship: null })).not.toContain('Отношения');
  });
});
