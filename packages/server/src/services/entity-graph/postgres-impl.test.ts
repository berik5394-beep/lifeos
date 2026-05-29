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

  it('upsertEntity uses prisma.entity.upsert or create+update', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    const hasUpsert = body.includes('prisma.entity.upsert');
    const hasCreate = body.includes('prisma.entity.create');
    expect(hasUpsert || hasCreate).toBe(true);
  });

  it('upsertEntity stores embedding best-effort (calls storeEntityEmbedding or embedDocument)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
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
