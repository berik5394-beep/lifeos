import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresBotTraits } from './postgres-impl.js';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/postgres-impl.ts'),
  'utf-8',
);

describe('PostgresBotTraits — class shape', () => {
  it('class exported + implements all methods', () => {
    const inst = new PostgresBotTraits();
    expect(typeof inst.getTraits).toBe('function');
    expect(typeof inst.refreshTraits).toBe('function');
    expect(typeof inst.refreshTraitsIfStale).toBe('function');
    expect(typeof inst.snapshot).toBe('function');
    expect(typeof inst.snapshotHistory).toBe('function');
  });
});

describe('postgres-impl.ts structural — getTraits', () => {
  it('reads BotIdentity via Prisma + parseTraitsJson', () => {
    const start = SRC.indexOf('async getTraits');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botIdentity.findUnique');
    expect(body).toContain('parseTraitsJson');
  });
  it('falls back to DEFAULT_TRAITS when identity missing', () => {
    const start = SRC.indexOf('async getTraits');
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('DEFAULT_TRAITS');
  });
});

describe('postgres-impl.ts structural — refreshTraits', () => {
  it('gathers stats: ChatMessage count, first msg, Entity count, MoodSnapshot', () => {
    const start = SRC.indexOf('async refreshTraits');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('chatMessage.count');
    expect(body).toContain('entity.count');
    expect(body).toContain('moodSnapshot');
  });
  it('reads B1 user axes via getUserAxesStore', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/getUserAxesStore\(\)\.getAxes/);
  });
  it('uses computeRelationshipDepth + computeBotTraits', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('computeRelationshipDepth');
    expect(body).toContain('computeBotTraits');
  });
  it('persists to BotIdentity.traits via update/upsert', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3500);
    expect(body).toMatch(/prisma\.botIdentity\.(update|upsert)/);
    expect(body).toContain('lastComputedAt');
  });
  it('best-effort try/catch — never throws', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3500);
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch/);
  });
});

describe('postgres-impl.ts structural — refreshTraitsIfStale', () => {
  it('reads current traits then compares lastComputedAt against staleMs', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('lastComputedAt');
    expect(body).toMatch(/staleMs/);
  });
  it('default stale window 6h', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/6\s*\*\s*60\s*\*\s*60\s*\*\s*1000|21_?600_?000/);
  });
  it('calls refreshTraits when stale', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/this\.refreshTraits\(/);
  });
});

describe('postgres-impl.ts structural — snapshot', () => {
  it('writes BotTraitSnapshot row with current traits', () => {
    const start = SRC.indexOf('async snapshot');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botTraitSnapshot.create');
    expect(body).toContain('warmth');
    expect(body).toContain('depth');
  });
});

describe('postgres-impl.ts structural — snapshotHistory', () => {
  it('queries BotTraitSnapshot ordered by recordedAt ASC (oldest first)', () => {
    const start = SRC.indexOf('async snapshotHistory');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botTraitSnapshot.findMany');
    expect(body).toMatch(/orderBy.*recordedAt.*asc/s);
  });
});
