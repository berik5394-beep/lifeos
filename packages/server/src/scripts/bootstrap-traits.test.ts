import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let parseCliArgs: (argv: string[]) => any;
let SCRIPT: string;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/bootstrap-traits.js', import.meta.url).href;
  const mod = await import(modulePath);
  parseCliArgs = mod.parseCliArgs;
  const testDir = dirname(new URL(import.meta.url).pathname);
  SCRIPT = readFileSync(join(testDir, '..', '..', 'scripts', 'bootstrap-traits.ts'), 'utf-8');
});

describe('bootstrap-traits — parseCliArgs', () => {
  it('--user=X --dry-run', () => {
    expect(parseCliArgs(['--user=abc', '--dry-run'])).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
  it('--user=X --apply', () => {
    expect(parseCliArgs(['--user=abc', '--apply'])).toEqual({ userId: 'abc', mode: 'apply' });
  });
  it('rejects missing user', () => {
    expect('error' in parseCliArgs(['--dry-run'])).toBe(true);
  });
  it('rejects empty user', () => {
    expect('error' in parseCliArgs(['--user=', '--apply'])).toBe(true);
  });
  it('rejects no mode', () => {
    expect('error' in parseCliArgs(['--user=abc'])).toBe(true);
  });
  it('rejects both modes', () => {
    expect('error' in parseCliArgs(['--user=abc', '--dry-run', '--apply'])).toBe(true);
  });
});

describe('bootstrap-traits structural', () => {
  it('computes RelationshipStats from real data', () => {
    expect(SCRIPT).toContain('chatMessage.count');
    expect(SCRIPT).toContain('entity.count');
    expect(SCRIPT).toContain('moodSnapshot');
  });
  it('calls refreshTraits + snapshot in apply mode', () => {
    expect(SCRIPT).toContain('refreshTraits');
    expect(SCRIPT).toContain('snapshot');
  });
  it('uses getBotTraitsStore', () => {
    expect(SCRIPT).toContain('getBotTraitsStore');
  });
  it('disconnects prisma + exit 1 on parse error', () => {
    expect(SCRIPT).toMatch(/\$disconnect/);
    expect(SCRIPT).toMatch(/process\.exit\(1\)/);
  });
});
