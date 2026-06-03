import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatObligationsSection } from './v2-enrichment.js';

describe('obligations enrichment', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/services/v2-enrichment.ts'),
    'utf-8',
  );
  it('за флагом + best-effort fetch + форматтер', () => {
    expect(src).toContain('isV2ObligationsEnabled');
    expect(src).toContain('openObligationsForContext');
    expect(src).toContain('formatObligationsSection');
  });
  it('formatObligationsSection: пусто → пусто; рендер по направлению', () => {
    expect(formatObligationsSection([])).toBe('');
    const out = formatObligationsSection([
      { direction: 'i_owe', personName: 'Серик', description: 'договор', due: '2026-06-05' },
      { direction: 'owed_to_me', personName: 'Ахмет', description: '500к', due: null },
    ]);
    expect(out).toContain('ты должен Серик: договор (срок 2026-06-05)');
    expect(out).toContain('тебе должен Ахмет: 500к');
  });
});
