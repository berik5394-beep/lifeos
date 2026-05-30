import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/analyze-message.ts'),
  'utf-8',
);

describe('analyze-message.ts structural', () => {
  it('exports analyzeMessage async function', () => {
    expect(SRC).toMatch(/export async function analyzeMessage\s*\(/);
  });
  it('calls anthropic.messages.create with MODELS.haiku', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    expect(fn).toContain('anthropic.messages.create');
    expect(fn).toContain('MODELS.haiku');
  });
  it('SYSTEM prompt instructs JSON-only output', () => {
    expect(SRC).toMatch(/ТОЛЬКО валидный JSON/);
  });
  it('SYSTEM prompt enumerates all 4 axes', () => {
    expect(SRC).toContain('self_discipline');
    expect(SRC).toContain('emotional_openness');
    expect(SRC).toContain('conflict_tolerance');
    expect(SRC).toContain('introspection_depth');
  });
  it('uses parseAxisResponse to parse Claude output', () => {
    expect(SRC).toContain('parseAxisResponse');
  });
  it('persists via getUserAxesStore().recordSignals', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.recordSignals/);
  });
  it('top-level try/catch — never throws to caller', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch/);
    expect(fn).toMatch(/console\.warn/);
  });
  it('skips empty text without making Claude call', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    // Either `text.trim()` early return or equivalent guard.
    expect(fn).toMatch(/trimmed\.length\s*===\s*0|!text\.trim/);
  });
});
