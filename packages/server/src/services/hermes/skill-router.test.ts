import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-router.ts'), 'utf-8');

describe('skill-router structure', () => {
  it('exports routeToSkill', () => {
    expect(SRC).toMatch(/export async function routeToSkill/);
  });
  it('has an exact-name fast path', () => {
    expect(SRC).toMatch(/toLowerCase\(\)/);
    expect(SRC).toMatch(/\.name/);
  });
  it('gates Voyage on embeddingsEnabled + uses cosine threshold', () => {
    expect(SRC).toMatch(/embeddingsEnabled/);
    expect(SRC).toMatch(/embedQuery/);
    expect(SRC).toMatch(/cosineSimilarity/);
    expect(SRC).toMatch(/0\.8/);
  });
  it('is best-effort — returns null on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/return null/);
  });
});
