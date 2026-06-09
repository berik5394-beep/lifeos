import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'),
  'utf-8',
);

describe('postgres-impl.ts structural — skeleton + upsertEntity', () => {
  it('exports PostgresEntityGraph class', () => {
    expect(SRC).toMatch(/export class PostgresEntityGraph/);
  });

  it('implements EntityGraphStore interface', () => {
    expect(SRC).toMatch(/implements EntityGraphStore/);
  });

  it('upsertEntity exported as async method', () => {
    expect(SRC).toMatch(/async upsertEntity\s*\(/);
  });

  it('upsertEntity uses prisma.entity.create (real call, not comment)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    // Якорь на ВСЮ функцию upsertEntity (до след. метода getEntity), не фикс-окно:
    // добавление строк внутри функции (напр. T5 guard) больше не выталкивает
    // create() за границу. Ассерт со СКОБКОЙ — не doc-коммент.
    const end = SRC.indexOf('async getEntity', start);
    const body = SRC.slice(start, end > start ? end : start + 5000);
    expect(body).toContain('prisma.entity.create(');
  });

  it('upsertEntity stores embedding best-effort (calls storeEntityEmbedding or embedDocument)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const end = SRC.indexOf('async getEntity', start);
    const body = SRC.slice(start, end > start ? end : start + 5000);
    const hasEmbed = body.includes('storeEntityEmbedding') || body.includes('embedDocument');
    expect(hasEmbed).toBe(true);
  });

  it('upsertEntity merges aliases (union dedup)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('aliases');
  });

  it('storeEntityEmbedding is a best-effort function (try/catch, no throw)', () => {
    expect(SRC).toMatch(/storeEntityEmbedding/);
    const start = SRC.indexOf('storeEntityEmbedding');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

describe('postgres-impl.ts structural — getEntity', () => {
  it('getEntity exported as async method', () => {
    expect(SRC).toMatch(/async getEntity\s*\(/);
  });

  it('getEntity calls prisma.entity.findUnique', () => {
    const start = SRC.indexOf('async getEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 400);
    expect(body).toContain('prisma.entity.findUnique');
  });

  it('getEntity does NOT throw for missing entity (returns null)', () => {
    const start = SRC.indexOf('async getEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 400);
    expect(body).toContain('null');
  });
});

describe('postgres-impl.ts structural — resolveEntity', () => {
  it('resolveEntity exported as async method', () => {
    expect(SRC).toMatch(/async resolveEntity\s*\(/);
  });

  it('resolveEntity uses plainto_tsquery for name FTS', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('plainto_tsquery');
  });

  it('resolveEntity falls back to embedding similarity when embeddingsEnabled', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('embeddingsEnabled');
    // pgvector cosine operator
    expect(body).toContain('<=>');
  });

  it('resolveEntity returns null if no match (not throw)', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('return null');
  });

  it('resolveEntity filters by type if provided', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('type');
  });
});

describe('postgres-impl.ts structural — resolveForMerge (T1)', () => {
  it('resolveForMerge экспортирован как async метод', () => {
    expect(SRC).toMatch(/async resolveForMerge\s*\(/);
  });
  it('Tier3 эмбеддинг за порогом shouldMergeByEmbedding + SELECT dist', () => {
    const start = SRC.indexOf('async resolveForMerge');
    const body = SRC.slice(start, start + 2800);
    expect(body).toContain('shouldMergeByEmbedding');
    expect(body).toContain('AS dist');
  });
  it('Tier1/2 точность: равенство стем-множеств (tsvector_to_array) + cardinality guard, без loose @@', () => {
    const start = SRC.indexOf('async resolveForMerge');
    const body = SRC.slice(start, start + 2800);
    // Set-equality of stemmed lexemes (not subset) — kills over-merge.
    expect(body).toContain('tsvector_to_array');
    // Empty-lexeme guard (all-stopword/punctuation names must not match each other).
    expect(body).toMatch(/cardinality\(tsvector_to_array/);
    // The Tier1/2 predicate no longer uses the loose `@@` FTS-contains operator.
    const tier12 = body.slice(0, body.indexOf('Tier 3') > -1 ? body.indexOf('Tier 3') : body.length);
    expect(tier12).not.toContain(' @@ ');
  });
});

describe('postgres-impl.ts structural — linkEntities', () => {
  it('linkEntities exported as async method', () => {
    expect(SRC).toMatch(/async linkEntities\s*\(/);
  });

  it('linkEntities checks for existing active relationship before creating', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    const hasFindFirst = body.includes('prisma.entityRelationship.findFirst');
    const hasQueryRaw = body.includes('$queryRaw');
    expect(hasFindFirst || hasQueryRaw).toBe(true);
  });

  it('linkEntities updates strength on duplicate triple (no new row)', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.entityRelationship.update');
    expect(body).toContain('strength');
  });

  it('linkEntities creates new row when no existing active triple', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.entityRelationship.create');
  });

  it('linkEntities defaults strength to 0.5 when not provided', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('0.5');
  });
});

import { clampDepth } from './postgres-impl.js';

describe('clampDepth — pure helper', () => {
  it('passes through values 1..5', () => {
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(3)).toBe(3);
    expect(clampDepth(5)).toBe(5);
  });

  it('clamps 0 to 1 (minimum useful depth)', () => {
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(-5)).toBe(1);
  });

  it('clamps > 5 to 5 (prevents runaway CTE)', () => {
    expect(clampDepth(6)).toBe(5);
    expect(clampDepth(100)).toBe(5);
  });
});

describe('postgres-impl.ts structural — getNeighbors', () => {
  it('getNeighbors exported as async method', () => {
    expect(SRC).toMatch(/async getNeighbors\s*\(/);
  });

  it('getNeighbors uses WITH RECURSIVE CTE', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('WITH RECURSIVE');
  });

  it('getNeighbors calls clampDepth before executing query', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('clampDepth(');
  });

  it('getNeighbors filters invalidAt IS NULL in CTE', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('invalidAt');
    expect(body).toContain('IS NULL');
  });

  it('getNeighbors uses $queryRawUnsafe (not tagged template — needs params)', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('$queryRawUnsafe');
  });

  it('clampDepth exported from module', () => {
    expect(SRC).toMatch(/export function clampDepth/);
  });
});

import { sinceDaysCutoff } from './postgres-impl.js';

describe('sinceDaysCutoff — pure helper', () => {
  it('returns date exactly N days before now', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const cutoff = sinceDaysCutoff(7, now);
    const expectedMs = now.getTime() - 7 * 86_400_000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it('works for 0 days (returns now)', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const cutoff = sinceDaysCutoff(0, now);
    expect(cutoff.getTime()).toBe(now.getTime());
  });

  it('works for 30 days', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const cutoff = sinceDaysCutoff(30, now);
    const expected = new Date('2026-05-02T00:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });
});

describe('postgres-impl.ts structural — staleEntities', () => {
  it('staleEntities exported as async method', () => {
    expect(SRC).toMatch(/async staleEntities\s*\(/);
  });

  it('staleEntities filters lastSeenAt before cutoff', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('lastSeenAt');
    expect(body).toContain('lt:');
  });

  it('staleEntities applies minImportance filter when provided', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('minImportance');
    expect(body).toContain('gte:');
  });

  it('staleEntities orders by importance DESC', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/orderBy.*importance.*desc/s);
  });

  it('sinceDaysCutoff exported from module', () => {
    expect(SRC).toMatch(/export function sinceDaysCutoff/);
  });
});
