import { describe, it, expect } from 'vitest';
import { normalizeEntityName, parseExtractorResponse } from './entity-extractor.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Pure helper: normalizeEntityName
// ---------------------------------------------------------------------------

describe('normalizeEntityName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeEntityName('  мама  ')).toBe('Мама');
  });

  it('collapses internal whitespace to single space', () => {
    expect(normalizeEntityName('Серик   Жумабаев')).toBe('Серик Жумабаев');
  });

  it('capitalizes first letter (Russian)', () => {
    expect(normalizeEntityName('работа')).toBe('Работа');
  });

  it('preserves already-capitalized names', () => {
    expect(normalizeEntityName('Алматы')).toBe('Алматы');
  });

  it('handles empty string gracefully', () => {
    expect(normalizeEntityName('')).toBe('');
  });

  it('handles single-char string', () => {
    expect(normalizeEntityName('а')).toBe('А');
  });
});

// ---------------------------------------------------------------------------
// Pure helper: parseExtractorResponse
// ---------------------------------------------------------------------------

describe('parseExtractorResponse — valid JSON', () => {
  it('parses valid entities + relationships', () => {
    const raw = JSON.stringify({
      entities: [
        { name: 'мама', type: 'person', attributes: { city: 'Алматы' } },
        { name: 'работа', type: 'concept' },
      ],
      relationships: [
        { fromName: 'мама', toName: 'работа', type: 'concern' },
      ],
    });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('мама');
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe('concern');
  });

  it('handles missing relationships key → empty array', () => {
    const raw = JSON.stringify({ entities: [{ name: 'Серик', type: 'person' }] });
    const result = parseExtractorResponse(raw);
    expect(result.relationships).toEqual([]);
  });

  it('handles missing entities key → empty array', () => {
    const raw = JSON.stringify({ relationships: [] });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toEqual([]);
  });
});

describe('parseExtractorResponse — malformed / fallback', () => {
  it('returns empty arrays for invalid JSON (never throws)', () => {
    const result = parseExtractorResponse('not json at all');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('strips markdown code fences before parsing', () => {
    const inner = JSON.stringify({ entities: [{ name: 'X', type: 'concept' }], relationships: [] });
    const wrapped = '```json\n' + inner + '\n```';
    const result = parseExtractorResponse(wrapped);
    expect(result.entities).toHaveLength(1);
  });

  it('returns empty arrays for null/undefined response', () => {
    expect(parseExtractorResponse('')).toEqual({ entities: [], relationships: [] });
  });

  it('returns empty arrays when entities is not an array', () => {
    const raw = JSON.stringify({ entities: 'wrong', relationships: [] });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-extractor.ts'),
  'utf-8',
);

describe('entity-extractor.ts structural — skeleton', () => {
  it('exports normalizeEntityName function', () => {
    expect(SRC).toMatch(/export function normalizeEntityName/);
  });

  it('exports parseExtractorResponse function', () => {
    expect(SRC).toMatch(/export function parseExtractorResponse/);
  });

  it('exports ExtractorResult type', () => {
    expect(SRC).toMatch(/export.*ExtractorResult/);
  });

  it('exports ExtractedEntityInput type', () => {
    expect(SRC).toMatch(/export.*ExtractedEntityInput/);
  });

  it('exports ExtractedRelationshipInput type', () => {
    expect(SRC).toMatch(/export.*ExtractedRelationshipInput/);
  });
});
