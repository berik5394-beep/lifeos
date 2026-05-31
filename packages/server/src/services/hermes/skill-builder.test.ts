import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-builder.ts'), 'utf-8');

describe('skill-builder structure', () => {
  it('exports both draft generators', () => {
    expect(SRC).toMatch(/export async function buildSkillFromRequest/);
    expect(SRC).toMatch(/export async function proposeSkillFromPattern/);
  });
  it('uses haiku + parseSkillSpec', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/parseSkillSpec/);
  });
  it('feeds the available tool list into the prompt', () => {
    expect(SRC).toMatch(/registryToolNames|capabilityText/);
  });
  it('is best-effort — returns null on failure, never throws', () => {
    expect(SRC).toMatch(/return null/);
    expect(SRC).toMatch(/catch/);
  });
});
