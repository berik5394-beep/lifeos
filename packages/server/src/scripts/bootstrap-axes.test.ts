import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let parseCliArgs: (argv: string[]) => any;
let SCRIPT: string;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/bootstrap-axes.js', import.meta.url).href;
  const mod = await import(modulePath);
  parseCliArgs = mod.parseCliArgs;
  const testDir = dirname(new URL(import.meta.url).pathname);
  SCRIPT = readFileSync(join(testDir, '..', '..', 'scripts', 'bootstrap-axes.ts'), 'utf-8');
});

describe('bootstrap-axes — parseCliArgs', () => {
  it('accepts --user=X --dry-run', () => {
    expect(parseCliArgs(['--user=abc', '--dry-run'])).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
  it('accepts --user=X --apply', () => {
    expect(parseCliArgs(['--user=abc', '--apply'])).toEqual({ userId: 'abc', mode: 'apply' });
  });
  it('rejects missing user', () => {
    expect('error' in parseCliArgs(['--dry-run'])).toBe(true);
  });
  it('rejects empty user value', () => {
    expect('error' in parseCliArgs(['--user=', '--apply'])).toBe(true);
  });
  it('rejects no mode', () => {
    expect('error' in parseCliArgs(['--user=abc'])).toBe(true);
  });
  it('rejects mutually exclusive modes', () => {
    expect('error' in parseCliArgs(['--user=abc', '--dry-run', '--apply'])).toBe(true);
  });
});

describe('bootstrap-axes script structural', () => {
  it('reads userProfile via prisma.userProfile.findUnique', () => {
    expect(SCRIPT).toMatch(/userProfile\.findUnique/);
  });
  it('calls Claude haiku with userProfile patterns', () => {
    expect(SCRIPT).toContain('anthropic.messages.create');
    expect(SCRIPT).toContain('MODELS.haiku');
    expect(SCRIPT).toMatch(/patterns/);
  });
  it('skips bootstrap if real (non-bootstrap) signals exist', () => {
    expect(SCRIPT).toMatch(/source.*claude_classifier|signalCount/);
  });
  it('writes bootstrap signals with source=bootstrap', () => {
    expect(SCRIPT).toContain("source: 'bootstrap'");
  });
  it('uses larger alpha for bootstrap (0.30) per spec §9.2', () => {
    expect(SCRIPT).toMatch(/0\.30|BOOTSTRAP_ALPHA/);
  });
  it('summary report includes axes + signalCount', () => {
    expect(SCRIPT).toContain('self_discipline');
    expect(SCRIPT).toContain('signalCount');
  });
});
