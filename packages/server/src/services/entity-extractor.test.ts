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

describe('entity-extractor.ts structural — extractEntities async', () => {
  it('extractEntities exported as async function', () => {
    expect(SRC).toMatch(/export async function extractEntities\s*\(/);
  });

  it('extractEntities calls anthropic.messages.create', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
  });

  it('extractEntities uses MODELS.haiku (fast/cheap for classify tasks)', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('MODELS.haiku');
  });

  it('extractEntities wraps entire call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
    // On error, must return empty (not throw)
    expect(body).toContain('entities: []');
  });

  it('extractEntities calls parseExtractorResponse to parse Claude output', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseExtractorResponse(');
  });

  it('extractEntities normalizes entity names via normalizeEntityName', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('normalizeEntityName(');
  });

  it('extractEntities system prompt includes JSON-only instruction', () => {
    // The system prompt must instruct Claude to return ONLY valid JSON.
    expect(SRC).toMatch(/ТОЛЬКО.*JSON|ONLY.*JSON|valid JSON/s);
  });
});

// ---------------------------------------------------------------------------
// Q1 (2026-05-31): isSelfReference + extractor drops self-refs
// ---------------------------------------------------------------------------
import { isSelfReference } from './entity-extractor.js';

describe('isSelfReference — pure helper (Q1 coreference dedup)', () => {
  it('detects Russian self-pronouns', () => {
    ['я', 'Я', 'меня', 'мне', 'себя', 'себе'].forEach((n) => {
      expect(isSelfReference(n)).toBe(true);
    });
  });
  it('detects "пользователь" / "юзер" / "user"', () => {
    ['Пользователь', 'юзер', 'User', 'I', 'me'].forEach((n) => {
      expect(isSelfReference(n)).toBe(true);
    });
  });
  it('matches the user\'s own first name when provided', () => {
    expect(isSelfReference('Берик', 'Берик')).toBe(true);
    expect(isSelfReference('берик', 'Берик')).toBe(true);
  });
  it('does NOT match other names', () => {
    expect(isSelfReference('Роза', 'Берик')).toBe(false);
    expect(isSelfReference('Серик', 'Берик')).toBe(false);
    expect(isSelfReference('Дана')).toBe(false);
  });
  it('empty/missing inputs are safe', () => {
    expect(isSelfReference('')).toBe(false);
    expect(isSelfReference('Роза', undefined)).toBe(false);
    expect(isSelfReference('Роза', '')).toBe(false);
  });
});

describe('entity-extractor.ts structural — Q1 filtering wired', () => {
  it('extractEntities signature exposes userName param', () => {
    expect(SRC).toMatch(/extractEntities\s*\(\s*[\s\S]*userName\?:\s*string/);
  });
  it('extractor filters entities through isSelfReference', () => {
    // Scope to the extractEntities function body only (skip parseExtractorResponse).
    const fn = SRC.slice(SRC.indexOf('export async function extractEntities'));
    const block = fn.slice(fn.indexOf('parsed.entities'), fn.indexOf('parsed.relationships'));
    expect(block).toMatch(/isSelfReference/);
  });
  it('extractor filters relationships when endpoint is self-ref', () => {
    const fn = SRC.slice(SRC.indexOf('export async function extractEntities'));
    const block = fn.slice(fn.indexOf('parsed.relationships'));
    expect(block).toMatch(/isSelfReference/);
  });
  it('SYSTEM_PROMPT instructs Claude to skip user-self', () => {
    expect(SRC).toMatch(/НЕ извлекай самого пользователя/);
  });
});
