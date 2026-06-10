import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dict = readFileSync(join(process.cwd(), 'src/services/dictation-service.ts'), 'utf8');

describe('F2 — extractFromChat supersede detection', () => {
  it('ExtractedMemory имеет supersedesTopic?', () => {
    expect(dict).toMatch(/supersedesTopic\?\s*:\s*string/);
  });
  it('extractFromChat принимает opts.detectSupersede', () => {
    expect(dict).toMatch(/detectSupersede\?\s*:\s*boolean/);
  });
  it('промпт supersede за флагом + правило «сомнение → НЕ добавляй»', () => {
    expect(dict).toContain('supersedesTopic');
    expect(dict).toMatch(/Сомнение.*НЕ добавляй|ЯВНОМ сигнале/);
  });
});

describe('F2 — supersedeByTopic', () => {
  const epi = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('экспортирует supersedeByTopic', () => { expect(epi).toMatch(/export async function supersedeByTopic\(/); });
  it('single-match-или-скип (strong.length !== 1 → null)', () => { expect(epi).toMatch(/strong\.length !== 1/); });
  it('зовёт invalidateEvent + лог SUPERSEDE', () => { expect(epi).toMatch(/invalidateEvent\(/); expect(epi).toContain('SUPERSEDE'); });
  it('константа SUPERSEDE_MIN_RANK', () => { expect(epi).toMatch(/SUPERSEDE_MIN_RANK\s*=/); });
});

describe('F2 — captureInBackground wiring', () => {
  const orch = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('передаёт detectSupersede в extractFromChat', () => { expect(orch).toMatch(/extractFromChat\([^)]*detectSupersede/s); });
  it('supersede-шаг за флагом + supersedesTopic', () => {
    expect(orch).toMatch(/isV2SupersedeEnabled\(userId\)/);
    expect(orch).toMatch(/supersedeByTopic\(/);
    expect(orch).toMatch(/m\.supersedesTopic/);
  });
});
