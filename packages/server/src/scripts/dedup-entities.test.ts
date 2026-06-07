import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Dynamic-import pattern: the script under scripts/ lives outside
// src/ rootDir, so a static `import ... from '../../scripts/...'`
// fails tsc's rootDir check. URL + dynamic await import() is opaque
// to tsc, fine at runtime.

let parseCliArgs: (argv: string[]) => any;
let normalizeKey: (s: string) => string;
let canonicalizeRelation: (s: string | null | undefined) => string | null;
let findSameNameAcrossTypes: (es: any[]) => Array<{ name: string; members: any[] }>;
let findRelationBasedPairs: (es: any[]) => Array<{ canonical: any; absorbed: any }>;
let pickCanonical: (es: any[]) => any;
let mergeAttributes: (c: Record<string, unknown>, o: Record<string, unknown>[]) => Record<string, unknown>;
let mergeAliases: (cs: string[], abs: any[]) => string[];
let RELATION_ALIASES: Record<string, string[]>;
let SCRIPT: string;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/dedup-entities.js', import.meta.url).href;
  const mod = await import(modulePath);
  parseCliArgs = mod.parseCliArgs;
  normalizeKey = mod.normalizeKey;
  canonicalizeRelation = mod.canonicalizeRelation;
  findSameNameAcrossTypes = mod.findSameNameAcrossTypes;
  findRelationBasedPairs = mod.findRelationBasedPairs;
  pickCanonical = mod.pickCanonical;
  mergeAttributes = mod.mergeAttributes;
  mergeAliases = mod.mergeAliases;
  RELATION_ALIASES = mod.RELATION_ALIASES;
  const testDir = dirname(new URL(import.meta.url).pathname);
  SCRIPT = readFileSync(join(testDir, '..', '..', 'scripts', 'dedup-entities.ts'), 'utf-8');
});

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
    expect('error' in parseCliArgs(['--dry-run'])).toBe(true);
  });
  it('rejects empty user value', () => {
    expect('error' in parseCliArgs(['--user=', '--dry-run'])).toBe(true);
  });
  it('rejects mutually exclusive modes', () => {
    expect('error' in parseCliArgs(['--user=abc', '--dry-run', '--apply'])).toBe(true);
  });
  it('rejects no mode', () => {
    expect('error' in parseCliArgs(['--user=abc'])).toBe(true);
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

function mkEnt(over: Record<string, unknown>): any {
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
    expect(groups[0].members.map((m: any) => m.type).sort()).toEqual(['concept', 'goal']);
  });
  it('skips same-type duplicates', () => {
    const ents = [
      mkEnt({ name: 'Дана', type: 'person' }),
      mkEnt({ name: 'Дана', type: 'person', id: 'b' }),
    ];
    expect(findSameNameAcrossTypes(ents)).toHaveLength(0);
  });
  it('case-insensitive grouping', () => {
    const ents = [
      mkEnt({ name: 'Вода', type: 'concept' }),
      mkEnt({ name: 'ВОДА', type: 'goal' }),
    ];
    expect(findSameNameAcrossTypes(ents)).toHaveLength(1);
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
    expect(findRelationBasedPairs([rosa, mama]).length).toBeLessThanOrEqual(1);
  });
  it('only considers persons', () => {
    const ents = [
      mkEnt({ name: 'Роза', type: 'concept', attributes: { relation: 'мама' } }),
      mkEnt({ name: 'Мама', type: 'person' }),
    ];
    expect(findRelationBasedPairs(ents)).toHaveLength(0);
  });
  it('Роза(relation=mother) ↔ Мама — EN→RU bridge', () => {
    const rosa = mkEnt({ name: 'Роза', type: 'person', attributes: { relation: 'mother' } });
    const mama = mkEnt({ name: 'Мама', type: 'person', id: 'm-id' });
    const pairs = findRelationBasedPairs([rosa, mama]);
    expect(pairs).toHaveLength(1);
  });
  it('Иван(relation=father) ↔ Папа matches', () => {
    const ivan = mkEnt({ name: 'Иван', type: 'person', attributes: { relation: 'father' } });
    const papa = mkEnt({ name: 'Папа', type: 'person' });
    expect(findRelationBasedPairs([ivan, papa])).toHaveLength(1);
  });
  it('Дана(relation=сестра) → no Сестра entity → no merge', () => {
    const dana = mkEnt({ name: 'Дана', type: 'person', attributes: { relation: 'сестра' } });
    expect(findRelationBasedPairs([dana])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// canonicalizeRelation + alias table
// ---------------------------------------------------------------------------

describe('canonicalizeRelation', () => {
  it('mother / mother / мать / Мам → мама', () => {
    expect(canonicalizeRelation('mother')).toBe('мама');
    expect(canonicalizeRelation('Mother')).toBe('мама');
    expect(canonicalizeRelation('мать')).toBe('мама');
    expect(canonicalizeRelation('Мам')).toBe('мама');
  });
  it('sister → сестра', () => {
    expect(canonicalizeRelation('sister')).toBe('сестра');
  });
  it('returns null for unknown/empty', () => {
    expect(canonicalizeRelation('')).toBeNull();
    expect(canonicalizeRelation(null)).toBeNull();
    expect(canonicalizeRelation('коллега')).toBeNull();
  });
});

describe('RELATION_ALIASES table', () => {
  it('contains 9 canonical relations', () => {
    ['мама', 'папа', 'сестра', 'брат', 'жена', 'муж', 'сын', 'дочь', 'друг'].forEach((k) =>
      expect(Object.keys(RELATION_ALIASES)).toContain(k),
    );
  });
});

// ---------------------------------------------------------------------------
// pickCanonical / mergeAttributes / mergeAliases
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

describe('mergeAttributes', () => {
  it('canonical wins on key conflict', () => {
    expect(
      mergeAttributes(
        { status: 'active', priority: 'high' },
        [{ status: 'inactive', detail: 'd1' }],
      ),
    ).toEqual({ status: 'active', priority: 'high', detail: 'd1' });
  });
  it('handles empty objects', () => {
    expect(mergeAttributes({}, [{}])).toEqual({});
    expect(mergeAttributes({ a: 1 }, [])).toEqual({ a: 1 });
  });
});

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
    expect(SCRIPT).toMatch(/import \{ PrismaClient/);
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
      's3_merges:',
      'rels_repointed:',
      'obls_repointed:',
      'entities_deleted:',
    ].forEach((label) => expect(SCRIPT).toContain(label));
  });
});

// ---------------------------------------------------------------------------
// Structural — S3 resolve-based dedup wiring
// (behavioral coverage lives in dedup-entities.it.test.ts — real Prisma + FTS)
// ---------------------------------------------------------------------------

describe('dedup-entities S3 structural', () => {
  it('exports the S3 entrypoints + helpers', async () => {
    const modulePath = new URL('../../scripts/dedup-entities.js', import.meta.url).href;
    const mod = await import(modulePath);
    expect(typeof mod.runS3ResolveBackfill).toBe('function');
    expect(typeof mod.findResolveDupPairs).toBe('function');
    expect(typeof mod.mergeEntityPair).toBe('function');
  });
  it('matches via russian FTS (to_tsvector/plainto_tsquery), not JS name-equality', () => {
    expect(SCRIPT).toMatch(/to_tsvector\('russian', e\.name\)/);
    expect(SCRIPT).toMatch(/plainto_tsquery\('russian'/);
    // Tier2: alias FTS on unnest(aliases).
    expect(SCRIPT).toMatch(/unnest\(e\.aliases\)/);
  });
  it('excludes the entity itself (e.id <> $self)', () => {
    expect(SCRIPT).toMatch(/e\.id <> \$3/);
  });
  it('moves BOTH FKs: entityRelationship AND obligation (data-loss fix)', () => {
    // The S1/S2 gap: Obligation.personEntityId is onDelete:SetNull, so S3 must
    // repoint obligations before deleting the absorbed row.
    expect(SCRIPT).toMatch(/prisma\.obligation\.updateMany/);
    expect(SCRIPT).toMatch(/personEntityId: canonical\.id/);
  });
  it('dry-run merge writes nothing', () => {
    // mergeEntityPair returns zero counts and short-circuits before any write
    // when mode !== 'apply'.
    expect(SCRIPT).toMatch(/if \(mode !== 'apply'\)/);
  });
});
