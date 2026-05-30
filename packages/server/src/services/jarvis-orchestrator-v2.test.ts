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
  it('imports isV2MemoryEnabled', () => {
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
    expect(SRC).toMatch(/isV2MemoryEnabled/);
  });
  it('captureInBackground wraps captureV2 in isV2MemoryEnabled gate, fire-and-forget', () => {
    const capFn = SRC.slice(SRC.indexOf('async function captureInBackground'));
    const head = capFn.slice(0, 3000);
    expect(head).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(head).toMatch(/void\s+captureV2InBackground\(/);
    expect(head).toMatch(/\.catch\(/);
  });
  it('preserves legacy dual-write — extractFromTranscript + captureMemory still present', () => {
    expect(SRC).toMatch(/extractFromTranscript\(/);
    expect(SRC).toMatch(/captureMemory\(/);
  });
  it('handleMessage appends v2 enrichment block to system prompt under flag', () => {
    const handle = SRC.slice(SRC.indexOf('export async function handleMessage'));
    expect(handle).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(handle).toMatch(/fetchV2EnrichmentData\(\s*userId\s*\)/);
    expect(handle).toMatch(/buildV2EnrichmentBlock\(/);
    // Block is appended (string concat) — not replacing system.
    expect(handle).toMatch(/system\s*\+=|system\s*=\s*system\s*\+/);
  });
});
