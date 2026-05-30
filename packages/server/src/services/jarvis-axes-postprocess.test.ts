import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — axes post-process hook (D2)', () => {
  it('imports content-rules helpers', () => {
    expect(SRC).toMatch(/from '\.\/user-axes\/content-rules\.js'/);
    expect(SRC).toContain('shouldForceOneStep');
    expect(SRC).toContain('extractStepCount');
  });
  it('imports getUserAxesStore + isV2AxesEnabled', () => {
    expect(SRC).toContain('getUserAxesStore');
    expect(SRC).toContain('isV2AxesEnabled');
  });
  it('post-process block invokes Gate 1 (step-count check)', () => {
    expect(SRC).toMatch(/shouldForceOneStep\(/);
    expect(SRC).toMatch(/extractStepCount\(/);
  });
  it('post-process gated by isV2AxesEnabled', () => {
    // Find the post-process region and confirm flag check is nearby.
    // Look for the actual gate1 call (after the import), not import statement
    const idx = SRC.indexOf('const gate1 = shouldForceOneStep');
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 600), idx);
    expect(window).toMatch(/isV2AxesEnabled(?:Flag)?\(\s*userId\s*\)/);
  });
});
