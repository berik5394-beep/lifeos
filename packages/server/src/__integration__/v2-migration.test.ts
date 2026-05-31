import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C3 — Integration test for migrate-to-v2 script.
 *
 * Structural: verifies the script imports the expected services and
 * has both branches (dry-run / apply) with the 4 migration steps in
 * order. Pure parser unit tests live in src/scripts/migrate-to-v2.test.ts.
 *
 * E2E coverage is the smoke-test in B2 Step 5/6 (manual local Docker run).
 */

const SCRIPT_PATH = join(
  __dirname,
  '..',
  '..',
  'scripts',
  'migrate-to-v2.ts',
);
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('migrate-to-v2 — script wiring', () => {
  it('imports PrismaClient + getEntityGraph + getProceduralMemory', () => {
    expect(SRC).toMatch(/PrismaClient/);
    expect(SRC).toMatch(/getEntityGraph/);
    expect(SRC).toMatch(/getProceduralMemory/);
  });

  it('parseCliArgs is exported (re-usable by tests)', () => {
    expect(SRC).toMatch(/export function parseCliArgs\(/);
  });

  it('script has both dry-run and apply branches', () => {
    expect(SRC).toMatch(/mode\s*===\s*['"]apply['"]/);
    // dry-run path: log [dry-run] without write
    expect(SRC).toMatch(/\[dry-run\]/);
  });

  it('all 4 migration steps present, in order', () => {
    const step1 = SRC.indexOf('Step 1');
    const step2 = SRC.indexOf('Step 2');
    const step3 = SRC.indexOf('Step 3');
    const step4 = SRC.indexOf('Step 4');
    expect(step1).toBeGreaterThan(0);
    expect(step2).toBeGreaterThan(step1);
    expect(step3).toBeGreaterThan(step2);
    expect(step4).toBeGreaterThan(step3);
  });

  it('step 1 — validAt backfill via raw SQL', () => {
    expect(SRC).toMatch(/UPDATE\s+"Memory"\s+SET\s+"validAt"\s*=\s*"createdAt"/i);
  });

  it('step 2 — Memory → Entity lift via upsertEntity', () => {
    expect(SRC).toMatch(/memory\.findMany/);
    expect(SRC).toMatch(/upsertEntity\(/);
  });

  it('step 2 — type mapping via Claude extractor (Q3 rewrite)', () => {
    // Q3 (2026-05-31) replaced naive case/switch mapMemoryToEntity with
    // Claude haiku extractor that returns canonical names + correct types.
    // Test now verifies the new architecture, not the old.
    expect(SRC).toMatch(/extractEntitiesFromMemory|extractEntities\(/);
    expect(SRC).toMatch(/userName/); // self-ref filter threaded through (Q1)
  });

  it('step 3 — BotIdentity upsert with default Эля + warm', () => {
    expect(SRC).toMatch(/botIdentity\.(upsert|create|findUnique)/);
    expect(SRC).toMatch(/['"]Эля['"]/);
    expect(SRC).toMatch(/['"]warm['"]/);
  });

  it('step 4 — UserProfile.relationships lift (Q2 addition)', () => {
    // Q2 (2026-05-31) added a step between Memory lift and extractPatterns
    // to copy UserProfile.relationships into the Entity graph.
    expect(SRC).toMatch(/userprofile_lift/);
    expect(SRC).toContain('profile_note');
  });

  it('step 5 — extractPatterns at the end', () => {
    // Q3 renumbered steps: extractPatterns moved from 4 → 5 after the
    // UserProfile lift was inserted as the new step 4.
    expect(SRC).toMatch(/extractPatterns\(/);
  });

  it('no $transaction (corpus is small, partial fail recoverable)', () => {
    expect(SRC).not.toMatch(/\$transaction\(/);
  });

  it('exit 1 on parse error', () => {
    expect(SRC).toMatch(/process\.exit\(1\)/);
  });

  it('disconnects prisma cleanly', () => {
    expect(SRC).toMatch(/\$disconnect/);
  });

  it('script lives under packages/server/scripts/ (matching backfill-embeddings.ts convention)', () => {
    // Sanity — protects against accidental relocation.
    expect(SCRIPT_PATH).toMatch(/scripts\/migrate-to-v2\.ts$/);
  });
});
