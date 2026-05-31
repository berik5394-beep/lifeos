import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — identity refresh hook (D1)', () => {
  it('imports getBotTraitsStore + isV2IdentityEnabled', () => {
    expect(SRC).toContain('getBotTraitsStore');
    expect(SRC).toMatch(/isV2IdentityEnabled/);
  });
  it('calls refreshTraitsIfStale under flag', () => {
    expect(SRC).toMatch(/refreshTraitsIfStale\(/);
  });
  it('hook gated by isV2IdentityEnabled', () => {
    const idx = SRC.indexOf('refreshTraitsIfStale');
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/isV2IdentityEnabled\(\s*userId\s*\)/);
  });
});
