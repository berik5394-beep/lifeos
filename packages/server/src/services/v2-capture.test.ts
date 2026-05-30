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
