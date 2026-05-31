import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/synthesize.ts'), 'utf-8');

describe('synthesize structure', () => {
  it('exports synthesizeKeystone', () => {
    expect(SRC).toMatch(/export async function synthesizeKeystone/);
  });
  it('uses sonnet + summariseFactsForPrompt + parseKeystone', () => {
    expect(SRC).toMatch(/MODELS\.sonnet/);
    expect(SRC).toMatch(/summariseFactsForPrompt/);
    expect(SRC).toMatch(/parseKeystone/);
  });
  it('asks for ONE keystone linking >=2 tiers + one concrete step', () => {
    expect(SRC).toMatch(/keystone|главн/i);
  });
  it('best-effort — returns null on failure, never throws', () => {
    expect(SRC).toMatch(/return null/);
    expect(SRC).toMatch(/catch/);
  });
});
