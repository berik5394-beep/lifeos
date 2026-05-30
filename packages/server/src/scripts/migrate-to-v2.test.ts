import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let parseCliArgs: (argv: string[]) => any;
let SRC: string;

beforeAll(async () => {
  // Dynamic import with indirect path construction to avoid rootDir check
  const modulePath = new URL(
    '../../scripts/migrate-to-v2.js',
    import.meta.url,
  ).href;
  const module = await import(modulePath);
  parseCliArgs = module.parseCliArgs;

  // Read script source for structural tests
  const testDir = dirname(new URL(import.meta.url).pathname);
  // testDir is src/scripts, need to go to scripts (one level up, then into scripts)
  const scriptPath = join(testDir, '..', '..', 'scripts', 'migrate-to-v2.ts');
  SRC = readFileSync(scriptPath, 'utf8');
});

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

describe('structural — B2 migration logic', () => {
  it('imports getEntityGraph + getProceduralMemory', () => {
    expect(SRC).toMatch(/getEntityGraph/);
    expect(SRC).toMatch(/getProceduralMemory/);
  });

  it('step 1: backfill Memory.validAt via raw SQL', () => {
    expect(SRC).toMatch(/UPDATE\s+"Memory"\s+SET\s+"validAt"\s*=\s*"createdAt"/i);
    expect(SRC).toMatch(/WHERE[\s\S]{0,80}?"validAt"\s+IS\s+NULL/i);
  });

  it('step 2: reads Memory rows for user and maps type → entity', () => {
    expect(SRC).toMatch(/memory\.findMany/);
    expect(SRC).toMatch(/upsertEntity/);
    expect(SRC).toMatch(/'person'/);
    expect(SRC).toMatch(/'place'/);
    // decision → goal mapping per spec §11
    expect(SRC).toMatch(/'decision'/);
    expect(SRC).toMatch(/'goal'/);
  });

  it('step 3: upsert BotIdentity with defaults', () => {
    expect(SRC).toMatch(/botIdentity\.upsert/);
    expect(SRC).toMatch(/['"]Эля['"]/);
  });

  it('step 4: calls extractPatterns at the end', () => {
    expect(SRC).toMatch(/extractPatterns\(\s*userId\s*\)/);
  });

  it('dry-run mode logs [dry-run] prefix and performs no writes', () => {
    expect(SRC).toMatch(/\[dry-run\]/);
    // All write calls must be inside `if (mode === 'apply')` or similar guards.
    expect(SRC).toMatch(/mode\s*===\s*['"]apply['"]/);
  });

  it('per-step try/catch (no $transaction wrapping the whole thing)', () => {
    // Sentinel: at least 4 try blocks (one per step).
    const tryCount = (SRC.match(/\btry\s*\{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(4);
    expect(SRC).not.toMatch(/\$transaction\(/);
  });

  it('end-of-run report with counts', () => {
    expect(SRC).toMatch(/memoriesBackfilled|entitiesCreated|identityCreated|patternsExtracted/);
  });
});

// ---------------------------------------------------------------------------
// Q2 (2026-05-31): UserProfile.relationships → Entity lift
// ---------------------------------------------------------------------------
import { readFileSync as readScript } from 'node:fs';
import { join as joinPath } from 'node:path';
const SCRIPT = readScript(
  joinPath(process.cwd(), 'scripts/migrate-to-v2.ts'),
  'utf-8',
);

describe('migrate-to-v2 — UserProfile relationships lift (Q2)', () => {
  it('reads userProfile.relationships', () => {
    expect(SCRIPT).toMatch(/userProfile\.findUnique[\s\S]*relationships:\s*true/);
  });
  it('upserts each relationship as person Entity with profile_note attribute', () => {
    expect(SCRIPT).toMatch(/source:\s*'userprofile_lift'/);
    expect(SCRIPT).toMatch(/profile_note/);
    expect(SCRIPT).toMatch(/type:\s*'person'/);
  });
  it('has both dry-run logging and apply upsert branches', () => {
    expect(SCRIPT).toMatch(/would upsert profile-lift entity/);
    expect(SCRIPT).toMatch(/graph\.upsertEntity\(userId,[\s\S]*source:\s*'userprofile_lift'/);
  });
  it('summary report includes profileLifted + profileSkipped counters', () => {
    expect(SCRIPT).toMatch(/profileLifted:\s*\$\{profileLifted\}/);
    expect(SCRIPT).toMatch(/profileSkipped:\s*\$\{profileSkipped\}/);
  });
});
