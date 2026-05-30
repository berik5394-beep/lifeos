import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCliArgs,
  normalizeKey,
  canonicalizeRelation,
  findSameNameAcrossTypes,
  findRelationBasedPairs,
  pickCanonical,
  mergeAttributes,
  mergeAliases,
  RELATION_ALIASES,
  type EntityLite,
} from '../../scripts/dedup-entities.js';

const SCRIPT = readFileSync(
  join(process.cwd(), 'scripts/dedup-entities.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('dedup-entities — parseCliArgs', () => {
  it('parses --user + --dry-run', () => {
    const r = parseCliArgs(['--user=abc', '--dry-run']);
    expect(r).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
  it('parses --user + --apply', () => {
    const r = parseCliArgs(['--user=abc', '--apply']);
    expect(r).toEqual({ userId: 'abc', mode: 'apply' });
  });
  it('rejects missing user', () => {
    const r = parseCliArgs(['--dry-run']);
    expect('error' in r).toBe(true);
  });
  it('rejects empty user value', () => {
    const r = parseCliArgs(['--user=', '--dry-run']);
    expect('error' in r).toBe(true);
  });
  it('rejects mutually exclusive modes', () => {
    const r = parseCliArgs(['--user=abc', '--dry-run', '--apply']);
    expect('error' in r).toBe(true);
  });
  it('rejects no mode', () => {
    const r = parseCliArgs(['--user=abc']);
    expect('error' in r).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------

describe('normalizeKey', () => {
  it('lowercases + trims + collapses whitespace', () => {
    expect(normalizeKey('  МАМА   ')).toBe('мама');
    expect(normalizeKey('Серик   Жумабаев')).toBe('серик жумабаев');
  });
});

// ---------------------------------------------------------------------------
// findSameNameAcrossTypes (S1)
// ---------------------------------------------------------------------------

function mkEnt(over: Partial<EntityLite>): EntityLite {
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 8),
    name: 'X',
    type: 'concept',
    importance: 5,
    aliases: [],
    attributes: {},
    createdAt: new Date('2026-05-30T00:00:00Z'),
    ...over,
  };
}

describe('findSameNameAcrossTypes (S1)', () => {
  it('finds concept+goal pair with same name', () => {
    const ents = [
      mkEnt({ name: 'Работа', type: 'concept' }),
      mkEnt({ name: 'Работа', type: 'goal' }),
      mkEnt({ name: 'Алматы', type: 'place' }),
    ];
    const groups = findSameNameAcrossTypes(ents);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.type).sort()).toEqual(['concept', 'goal']);
  });
  it('skips same-type duplicates (already prevented by unique key)', () => {
    const ents = [
      mkEnt({ name: 'Дана', type: 'person' }),
      mkEnt({ name: 'Дана', type: 'person', id: 'b' }),
    ];
    const groups = findSameNameAcrossTypes(ents);
    expect(groups).toHaveLength(0);
  });
  it('case-insensitive grouping', () => {
    const ents = [
      mkEnt({ name: 'Вода', type: 'concept' }),
      mkEnt({ name: 'ВОДА', type: 'goal' }),
    ];
    const groups = findSameNameAcrossTypes(ents);
    expect(groups).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findRelationBasedPairs (S2)
// ---------------------------------------------------------------------------

describe('findRelationBasedPairs (S2)', () => {
  it('matches Роза(relation=мама) ↔ Мама', () => {
    const rosa = mkEnt({ name: 'Роза', type: 'person', attributes: { relation: 'мама' } });
    const mama = mkEnt({ name: 'Мама', type: 'person', id: 'mama-id' });
    const pairs = findRelationBasedPairs([rosa, mama, mkEnt({ name: 'Серик' })]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].canonical.name).toBe('Роза');
    expect(pairs[0].absorbed.name).toBe('Мама');
  });
  it('skips when only one side exists', () => {
    const rosa = mkEnt({ name: 'Роза', type: 'person', attributes: { relation: 'мама' } });
    expect(findRelationBasedPairs([rosa])).toHaveLength(0);
  });
  it('skips self-relation', () => {
    const x = mkEnt({ name: 'Мама', type: 'person', attributes: { relation: 'мама' } });
    expect(findRelationBasedPairs([x])).toHaveLength(0);
  });
  it('dedupes both-direction pairs', () => {
    const rosa = mkEnt({ name: 'Роза', type: 'person', attributes: { relation: 'мама' } });
    const mama = mkEnt({ name: 'Мама', type: 'person', attributes: { relation: 'роза' } });
    const pairs = findRelationBasedPairs([rosa, mama]);
    expect(pairs.length).toBeLessThanOrEqual(1);
  });
  it('only considers persons', () => {
    const ents = [
      mkEnt({ name: 'Роза', type: 'concept', attributes: { relation: 'мама' } }),
      mkEnt({ name: 'Мама', type: 'person' }),
    ];
    expect(findRelationBasedPairs(ents)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pickCanonical
// ---------------------------------------------------------------------------

describe('pickCanonical', () => {
  it('picks highest importance', () => {
    const a = mkEnt({ id: 'a', importance: 5 });
    const b = mkEnt({ id: 'b', importance: 9 });
    expect(pickCanonical([a, b]).id).toBe('b');
  });
  it('ties broken by oldest createdAt', () => {
    const old = mkEnt({ id: 'old', importance: 7, createdAt: new Date('2026-01-01') });
    const newer = mkEnt({ id: 'new', importance: 7, createdAt: new Date('2026-05-30') });
    expect(pickCanonical([newer, old]).id).toBe('old');
  });
});

// ---------------------------------------------------------------------------
// mergeAttributes
// ---------------------------------------------------------------------------

describe('mergeAttributes', () => {
  it('canonical wins on key conflict', () => {
    const c = { status: 'active', priority: 'high' };
    const others = [{ status: 'inactive', detail: 'd1' }];
    expect(mergeAttributes(c, others)).toEqual({
      status: 'active',
      priority: 'high',
      detail: 'd1',
    });
  });
  it('handles empty/missing attribute objects', () => {
    expect(mergeAttributes({}, [{}])).toEqual({});
    expect(mergeAttributes({ a: 1 }, [])).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// mergeAliases
// ---------------------------------------------------------------------------

describe('mergeAliases', () => {
  it('union dedupes', () => {
    const canonical = ['Мам', 'Мама'];
    const absorbed = [mkEnt({ name: 'Мама' }), mkEnt({ name: 'Мамочка', aliases: ['Мам'] })];
    expect(mergeAliases(canonical, absorbed).sort()).toEqual(['Мам', 'Мама', 'Мамочка']);
  });
});

// ---------------------------------------------------------------------------
// Structural — script wiring
// ---------------------------------------------------------------------------

describe('dedup-entities script structural', () => {
  it('imports PrismaClient', () => {
    expect(SCRIPT).toMatch(/import \{ PrismaClient \}/);
  });
  it('has dry-run vs apply branches for S1', () => {
    expect(SCRIPT).toMatch(/S1:.*"\$\{canonical\.name\}"/);
    expect(SCRIPT).toMatch(/await prisma\.entity\.delete/);
    expect(SCRIPT).toMatch(/entityRelationship\.updateMany/);
  });
  it('has dry-run vs apply branches for S2', () => {
    expect(SCRIPT).toMatch(/S2:.*canonical=/);
  });
  it('reports summary with all counters', () => {
    [
      's1_merges:',
      's1_skipped:',
      's2_merges:',
      's2_skipped:',
      'rels_repointed:',
      'entities_deleted:',
    ].forEach((label) => expect(SCRIPT).toContain(label));
  });
});

// ---------------------------------------------------------------------------
// canonicalizeRelation + cross-language S2
// ---------------------------------------------------------------------------

describe('canonicalizeRelation', () => {
  it('mother → мама', () => {
    expect(canonicalizeRelation('mother')).toBe('мама');
    expect(canonicalizeRelation('Mother')).toBe('мама');
    expect(canonicalizeRelation('мать')).toBe('мама');
    expect(canonicalizeRelation('Мам')).toBe('мама');
  });
  it('sister → сестра', () => {
    expect(canonicalizeRelation('sister')).toBe('сестра');
    expect(canonicalizeRelation('Сестра')).toBe('сестра');
  });
  it('null/empty/unknown returns null', () => {
    expect(canonicalizeRelation('')).toBeNull();
    expect(canonicalizeRelation(null)).toBeNull();
    expect(canonicalizeRelation('коллега')).toBeNull();
  });
  it('RELATION_ALIASES exports core 9 keys', () => {
    expect(Object.keys(RELATION_ALIASES)).toContain('мама');
    expect(Object.keys(RELATION_ALIASES)).toContain('папа');
    expect(Object.keys(RELATION_ALIASES)).toContain('сестра');
    expect(Object.keys(RELATION_ALIASES)).toContain('брат');
  });
});

describe('findRelationBasedPairs — cross-language (Q4 enhancement)', () => {
  it('Роза(relation=mother) ↔ Мама — EN→RU bridge', () => {
    const rosa = {
      id: 'r', name: 'Роза', type: 'person', importance: 9,
      aliases: [], attributes: { relation: 'mother' },
      createdAt: new Date('2026-05-30'),
    };
    const mama = {
      id: 'm', name: 'Мама', type: 'person', importance: 8,
      aliases: [], attributes: {}, createdAt: new Date('2026-05-30'),
    };
    const pairs = findRelationBasedPairs([rosa, mama]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].canonical.id).toBe('r');
    expect(pairs[0].absorbed.id).toBe('m');
  });
  it('Иван(relation=father) ↔ Папа matches', () => {
    const ivan = {
      id: 'i', name: 'Иван', type: 'person', importance: 8,
      aliases: [], attributes: { relation: 'father' },
      createdAt: new Date('2026-05-30'),
    };
    const papa = {
      id: 'p', name: 'Папа', type: 'person', importance: 7,
      aliases: [], attributes: {}, createdAt: new Date('2026-05-30'),
    };
    expect(findRelationBasedPairs([ivan, papa])).toHaveLength(1);
  });
  it('still skips when no matching person exists', () => {
    const dana = {
      id: 'd', name: 'Дана', type: 'person', importance: 8,
      aliases: [], attributes: { relation: 'сестра' },
      createdAt: new Date('2026-05-30'),
    };
    // No entity named "Сестра"
    expect(findRelationBasedPairs([dana])).toHaveLength(0);
  });
});
