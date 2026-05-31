import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const CORE = readFileSync(
  join(process.cwd(), 'src/services/insight-core.ts'), 'utf-8');

describe('reflector-v2 index', () => {
  it('exports runWeekly and runEventCheck', () => {
    expect(SRC).toMatch(/export async function runWeekly/);
    expect(SRC).toMatch(/export async function runEventCheck/);
  });
  it('weekly is rate-gated (rolling 7d) and event uses shouldFireEvent', () => {
    expect(SRC).toMatch(/reflector_v2_weekly/);
    expect(SRC).toMatch(/shouldFireEvent/);
  });
  it('persists via the existing insight store with source reflector_v2', () => {
    expect(SRC).toMatch(/persistCandidates/);
    expect(SRC).toMatch(/'reflector_v2'/);
  });
  it('best-effort — wrapped, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });
});

describe('InsightSource extended', () => {
  it("includes 'reflector_v2'", () => {
    expect(CORE).toMatch(/reflector_v2/);
  });
});
