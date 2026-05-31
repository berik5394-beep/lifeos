import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/growth-narrative.ts'),
  'utf-8',
);

describe('growth-narrative.ts structural', () => {
  it('exports generateGrowthNarrative async function', () => {
    expect(SRC).toMatch(/export async function generateGrowthNarrative\s*\(/);
  });
  it('returns "still getting to know you" message when no oldest snapshot', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    // Early return for null oldest — no Claude call.
    expect(fn).toMatch(/oldest\s*===?\s*null|!oldest/);
    expect(fn.toLowerCase()).toMatch(/узна|знаком/);
  });
  it('calls anthropic.messages.create with MODELS.haiku', () => {
    expect(SRC).toContain('anthropic.messages.create');
    expect(SRC).toContain('MODELS.haiku');
  });
  it('system prompt is first-person Russian comparing then vs now', () => {
    expect(SRC).toMatch(/ТОГДА|первого лица/);
    expect(SRC).toMatch(/СЕЙЧАС/);
  });
  it('best-effort try/catch with template fallback', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch/);
  });
  it('constructs userContent comparing oldest vs current trait values', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    expect(fn).toContain('userContent');
    expect(fn).toContain('oldest.warmth');
    expect(fn).toContain('current.warmth');
  });
  it('extracts text from response.content[0] defensively', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    expect(fn).toContain('response.content[0]');
    expect(fn).toMatch(/content\.type\s*!==\s*['"]text['"]|content\.type\s*!==\s*['"]text['"]/);
  });
  it('imports Anthropic + MODELS + types', () => {
    expect(SRC).toContain("import Anthropic from '@anthropic-ai/sdk'");
    expect(SRC).toContain("import { MODELS } from '../../lib/models.js'");
    expect(SRC).toMatch(/import.*BotTraits.*TraitSnapshot.*from.*types/);
  });
});
