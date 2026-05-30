import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickActiveUsers,
  runPatternExtraction,
} from './pattern-extraction-cron.js';

const SRC = readFileSync(
  join(__dirname, 'pattern-extraction-cron.ts'),
  'utf8',
);

describe('pickActiveUsers — pure', () => {
  const now = new Date('2026-05-31T12:00:00Z');
  it('includes users active within window', () => {
    const u = [
      { id: 'u1', lastMessageAt: new Date('2026-05-30T10:00:00Z') }, // 1d ago
      { id: 'u2', lastMessageAt: new Date('2026-05-25T10:00:00Z') }, // 6d ago
      { id: 'u3', lastMessageAt: new Date('2026-05-20T10:00:00Z') }, // 11d ago
    ];
    const out = pickActiveUsers(u, 7, now);
    expect(out.map((x) => x.id).sort()).toEqual(['u1', 'u2']);
  });
  it('excludes users with no recent messages', () => {
    const u = [{ id: 'u1', lastMessageAt: null }];
    expect(pickActiveUsers(u, 7, now)).toEqual([]);
  });
  it('default window = 7 days', () => {
    const u = [
      { id: 'u1', lastMessageAt: new Date('2026-05-28T10:00:00Z') }, // 3d
      { id: 'u2', lastMessageAt: new Date('2026-05-20T10:00:00Z') }, // 11d
    ];
    const out = pickActiveUsers(u, undefined, now);
    expect(out.map((x) => x.id)).toEqual(['u1']);
  });
  it('empty input → empty output', () => {
    expect(pickActiveUsers([], 7, now)).toEqual([]);
  });
});

describe('structural — runPatternExtraction', () => {
  it('queries User joined with last ChatMessage', () => {
    expect(SRC).toMatch(/chatMessage|ChatMessage/);
    expect(SRC).toMatch(/findMany/);
  });
  it('uses pickActiveUsers with 7-day window', () => {
    expect(SRC).toMatch(/pickActiveUsers\(/);
    expect(SRC).toMatch(/sinceDays:\s*7|,\s*7\s*[,)]/);
  });
  it('iterates SEQUENTIALLY (for...of, not Promise.all)', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+/);
    // No Promise.all of the per-user extraction (we explicitly want sequential
    // to respect Claude rate limit).
    expect(body).not.toMatch(/Promise\.all\(\s*\w+\.map/);
  });
  it('calls getProceduralMemory().extractPatterns per user', () => {
    expect(SRC).toMatch(/getProceduralMemory\(\)\.extractPatterns\(/);
  });
  it('wraps per-user call in its own try/catch', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).toMatch(/try\s*\{[\s\S]{0,400}?extractPatterns/);
    expect(body).toMatch(/\[cron:pattern-extraction\]/);
  });
  it('never throws — outer try/catch returns void', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).not.toMatch(/^\s*throw\s+/m);
  });
});

// Runtime integration test — deferred to v2-integration suite (C2).
// Structural tests above verify the function shape + pure logic.
