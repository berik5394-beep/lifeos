import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Note: script lives in packages/server/scripts/, not packages/server/src/.
// Resolve relative to this test file.
import { parseCliArgs } from '../../scripts/migrate-to-v2.js';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'migrate-to-v2.ts');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('parseCliArgs — pure', () => {
  it('accepts --user=X --dry-run', () => {
    const out = parseCliArgs(['--user=abc123', '--dry-run']);
    expect(out).toEqual({ userId: 'abc123', mode: 'dry-run' });
  });
  it('accepts --user=X --apply', () => {
    const out = parseCliArgs(['--user=abc123', '--apply']);
    expect(out).toEqual({ userId: 'abc123', mode: 'apply' });
  });
  it('order-independent', () => {
    expect(parseCliArgs(['--dry-run', '--user=xyz'])).toEqual({
      userId: 'xyz',
      mode: 'dry-run',
    });
  });
  it('rejects missing --user', () => {
    const out = parseCliArgs(['--dry-run']);
    expect('error' in out).toBe(true);
  });
  it('rejects missing mode', () => {
    const out = parseCliArgs(['--user=abc']);
    expect('error' in out).toBe(true);
  });
  it('rejects both modes', () => {
    const out = parseCliArgs(['--user=abc', '--dry-run', '--apply']);
    expect('error' in out).toBe(true);
  });
  it('rejects empty user', () => {
    const out = parseCliArgs(['--user=', '--apply']);
    expect('error' in out).toBe(true);
  });
  it('ignores unknown args (defensive)', () => {
    const out = parseCliArgs(['--user=abc', '--dry-run', '--verbose']);
    expect(out).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
});

describe('structural — skeleton', () => {
  it('exports parseCliArgs', () => {
    expect(SRC).toMatch(/export function parseCliArgs\(/);
  });
  it('has a main() entrypoint', () => {
    expect(SRC).toMatch(/async function main\(\s*\)/);
  });
  it('uses process.argv', () => {
    expect(SRC).toMatch(/process\.argv/);
  });
  it('imports PrismaClient', () => {
    expect(SRC).toMatch(/PrismaClient/);
  });
  it('top-level catch + prisma.$disconnect in finally', () => {
    expect(SRC).toMatch(/\$disconnect/);
    expect(SRC).toMatch(/\.catch\(/);
  });
});
