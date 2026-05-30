import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C1 — Integration test for the inbound consolidation flow.
 *
 * Verifies the full call chain from message arrival to memory-tier write
 * is wired correctly. Structural (not E2E): each link in the chain
 * imports + calls the next. E2E coverage is via F1 SMOKE (Berik runs
 * manually on Railway in Week 7).
 *
 * Chain (per spec §8.1):
 *   handleMessage
 *     → captureInBackground (legacy + v2 dual-write under flag)
 *       → captureV2InBackground
 *         → extractEntities → entityGraph.upsertEntity
 *         → entityGraph.linkEntities
 *         → episodic.recordEvent
 *         → emotional.analyzeMessage
 */

const ROOT = join(__dirname, '..', 'services');
const ORCH = readFileSync(join(ROOT, 'jarvis-orchestrator.ts'), 'utf8');
const CAPTURE = readFileSync(join(ROOT, 'v2-capture.ts'), 'utf8');

describe('v2 consolidation flow — orchestrator → captureV2 chain', () => {
  it('orchestrator imports captureV2InBackground (D3 wiring preserved)', () => {
    expect(ORCH).toMatch(/from '\.\/v2-capture\.js'/);
    expect(ORCH).toMatch(/captureV2InBackground/);
  });

  it('orchestrator gates captureV2 behind isV2MemoryEnabled', () => {
    const capFn = ORCH.slice(ORCH.indexOf('async function captureInBackground'));
    const head = capFn.slice(0, 3000);
    expect(head).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(head).toMatch(/captureV2InBackground\(/);
  });

  it('orchestrator preserves legacy dual-write (Memory writes still fire)', () => {
    expect(ORCH).toMatch(/extractFromTranscript\(/);
    expect(ORCH).toMatch(/captureMemory\(/);
  });

  it('captureV2 imports + calls extractEntities', () => {
    expect(CAPTURE).toMatch(/from '\.\/entity-extractor\.js'/);
    expect(CAPTURE).toMatch(/extractEntities\(/);
  });

  it('captureV2 imports getEntityGraph and calls upsertEntity + linkEntities', () => {
    expect(CAPTURE).toMatch(/from '\.\/entity-graph\/index\.js'/);
    expect(CAPTURE).toMatch(/upsertEntity\(/);
    expect(CAPTURE).toMatch(/linkEntities\(/);
  });

  it('captureV2 imports episodic.recordEvent', () => {
    expect(CAPTURE).toMatch(/from '\.\/episodic-memory\.js'/);
    expect(CAPTURE).toMatch(/recordEvent\(/);
  });

  it('captureV2 imports emotional.analyzeMessage', () => {
    expect(CAPTURE).toMatch(/from '\.\/emotional-memory\.singleton\.js'/);
    expect(CAPTURE).toMatch(/analyzeMessage\(/);
  });

  it('captureV2 is top-level wrapped in try/catch (never throws to caller)', () => {
    expect(CAPTURE).toMatch(/try\s*\{[\s\S]+catch[\s\S]+console\.(warn|error)/);
  });

  it('upserts happen BEFORE relationship linking BEFORE event recording', () => {
    // Sequential dependency: idByName populated by upserts, used by links + entityRefs.
    const upsertIdx = CAPTURE.indexOf('upsertEntity(');
    const linkIdx = CAPTURE.indexOf('linkEntities(');
    const eventIdx = CAPTURE.indexOf('recordEvent(');
    expect(upsertIdx).toBeGreaterThan(0);
    expect(upsertIdx).toBeLessThan(linkIdx);
    expect(linkIdx).toBeLessThan(eventIdx);
  });

  it('analyzeMessage is called with entityRefs derived from upsert results', () => {
    // entityRefs is constructed before the Promise.allSettled block.
    expect(CAPTURE).toMatch(/const entityRefs = Array\.from\(idByName\.values\(\)\)/);
    expect(CAPTURE).toMatch(/emotional\.analyzeMessage\(/);
  });

  it('handleMessage appends v2 enrichment block under flag (D3 prompt-side wiring)', () => {
    const handle = ORCH.slice(ORCH.indexOf('export async function handleMessage'));
    expect(handle).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(handle).toMatch(/fetchV2EnrichmentData\(/);
    expect(handle).toMatch(/buildV2EnrichmentBlock\(/);
  });
});
