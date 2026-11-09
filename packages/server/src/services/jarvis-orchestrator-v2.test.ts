import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'jarvis-orchestrator.ts'), 'utf8');

describe('jarvis-orchestrator — v2 wiring (D3)', () => {
  it('imports captureV2InBackground from v2-capture', () => {
    expect(SRC).toMatch(/from '\.\/v2-capture\.js'/);
    expect(SRC).toMatch(/captureV2InBackground/);
  });
  it('imports buildV2EnrichmentBlock + fetchV2EnrichmentData', () => {
    expect(SRC).toMatch(/from '\.\/v2-enrichment\.js'/);
    expect(SRC).toMatch(/buildV2EnrichmentBlock/);
    expect(SRC).toMatch(/fetchV2EnrichmentData/);
  });
  it('captureInBackground вызывает captureV2 fire-and-forget (без флага)', () => {
    const capFn = SRC.slice(SRC.indexOf('async function captureInBackground'));
    const head = capFn.slice(0, 3000);
    expect(SRC).not.toMatch(/isV2MemoryEnabled/);
    expect(head).toMatch(/void\s+captureV2InBackground\(/);
    expect(head).toMatch(/\.catch\(/);
  });
  it('пишет через единый writeMemory; legacy captureMemory удалён (M3 Unit A)', () => {
    expect(SRC).toMatch(/extractFromTranscript\(/);
    expect(SRC).toMatch(/writeMemory\(/);
    expect(SRC).not.toMatch(/(await|void)\s+captureMemory\(/);
  });
  it('handleMessage appends v2 enrichment block to system prompt', () => {
    const handle = SRC.slice(SRC.indexOf('export async function handleMessage'));
    expect(handle).toMatch(/fetchV2EnrichmentData\(\s*userId\s*\)/);
    expect(handle).toMatch(/buildV2EnrichmentBlock\(/);
    // Block is appended (string concat) — not replacing system.
    expect(handle).toMatch(/system\s*\+=|system\s*=\s*system\s*\+/);
  });
});
