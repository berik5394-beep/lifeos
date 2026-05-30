import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureV2InBackground } from './v2-capture.js';

const SRC = readFileSync(join(__dirname, 'v2-capture.ts'), 'utf8');

describe('v2-capture — structural', () => {
  it('exports captureV2InBackground(userId, text, msgId)', () => {
    expect(typeof captureV2InBackground).toBe('function');
    expect(SRC).toMatch(/export async function captureV2InBackground\(/);
    expect(SRC).toMatch(/userId:\s*string/);
    expect(SRC).toMatch(/text:\s*string/);
    expect(SRC).toMatch(/msgId/);
  });
  it('orchestrates: extractEntities → upsert → link → recordEvent → analyzeMessage', () => {
    expect(SRC).toMatch(/extractEntities\(/);
    expect(SRC).toMatch(/upsertEntity\(/);
    expect(SRC).toMatch(/linkEntities\(/);
    expect(SRC).toMatch(/recordEvent\(/);
    expect(SRC).toMatch(/analyzeMessage\(/);
  });
  it('top-level Promise.allSettled so faults isolate', () => {
    expect(SRC).toMatch(/Promise\.allSettled/);
  });
  it('never throws — outer try/catch returns void on error', () => {
    expect(SRC).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]{0,200}?console\.(warn|error)/);
  });
  it('does NOT call captureMemory or extractFromTranscript (dual-write happens in orchestrator)', () => {
    expect(SRC).not.toMatch(/captureMemory\b/);
    expect(SRC).not.toMatch(/extractFromTranscript\b/);
  });
});

describe('captureV2InBackground — runtime safety', () => {
  it(
    'does not throw on invalid userId',
    async () => {
      await expect(
        captureV2InBackground('___no_such_user___', 'hi', 'msg-x'),
      ).resolves.toBeUndefined();
    },
    { timeout: 15_000 },
  );
});

// ---------------------------------------------------------------------------
// F2 fix (2026-05-30): pass entityRefs into analyzeMessage
// ---------------------------------------------------------------------------
describe('v2-capture — analyzeMessage entityRefs propagation (F2 fix)', () => {
  it('analyzeMessage called with entityRefs as 4th argument', () => {
    expect(SRC).toMatch(/emotional\.analyzeMessage\(\s*userId,\s*msgId,\s*text,\s*entityRefs/);
  });
});

// ---------------------------------------------------------------------------
// Q1 (2026-05-31): v2-capture fetches userName + passes to extractEntities
// ---------------------------------------------------------------------------
describe('v2-capture — userName fetched for self-ref filter (Q1)', () => {
  it('fetches user.name via prisma.user.findUnique', () => {
    expect(SRC).toMatch(/prisma\.user\s*\n?\s*\.findUnique\(\{\s*where:\s*\{\s*id:\s*userId\s*\}/);
    expect(SRC).toMatch(/select:\s*\{\s*name:\s*true\s*\}/);
  });
  it('extractEntities called with userName as 3rd arg', () => {
    expect(SRC).toMatch(/extractEntities\(\s*text,\s*userId,\s*userName\s*\)/);
  });
  it('userName lookup is best-effort (falls back to undefined on error)', () => {
    expect(SRC).toMatch(/\.catch\(\(\)\s*=>\s*undefined\)/);
  });
});

// ---------------------------------------------------------------------------
// D2 — v2 Phase B1 user-axes parallel branch
// ---------------------------------------------------------------------------
describe('v2-capture — user-axes parallel branch (D2)', () => {
  it('imports analyzeMessage from user-axes', () => {
    expect(SRC).toMatch(/from '\.\/user-axes\/analyze-message\.js'/);
  });
  it('imports isV2AxesEnabled', () => {
    expect(SRC).toContain('isV2AxesEnabled');
  });
  it('parallel branch fires under flag', () => {
    const captureIdx = SRC.indexOf('Promise.allSettled');
    expect(captureIdx).toBeGreaterThan(0);
    const settledRegion = SRC.slice(captureIdx, captureIdx + 2000);
    expect(settledRegion).toMatch(/isV2AxesEnabled\(\s*userId\s*\)/);
    expect(settledRegion).toMatch(/userAxesAnalyzeMessage\(\s*userId\s*,\s*msgId\s*,\s*text/);
  });
  it('wrapped in best-effort catch', () => {
    const settledIdx = SRC.indexOf('Promise.allSettled');
    const settledRegion = SRC.slice(settledIdx, settledIdx + 2000);
    expect(settledRegion).toMatch(/\.catch\(/);
  });
});
