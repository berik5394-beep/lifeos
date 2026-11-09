import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const f = readFileSync(join(process.cwd(), 'src/services/dictation-service.ts'), 'utf8');

describe('T4 extractFromChat — консервативный промпт', () => {
  it('экспортирует extractFromChat', () => {
    expect(f).toMatch(/export async function extractFromChat\(/);
  });
  it('промпт требует точность > полноты и «не извлекай при сомнении»', () => {
    expect(f).toContain('точность важнее полноты');
    expect(f).toMatch(/Сомневаешься\s*—\s*НЕ извлекай|не извлекай/i);
  });
  it('эмоции из чата НЕ извлекаются', () => {
    expect(f).toMatch(/эмоции\/настроение.*НЕ извлекаем вообще/s);
  });
  it('возвращает только tasks+memories (Pick), без фейкового summary', () => {
    expect(f).toMatch(/Pick<DictationExtraction, 'tasks' \| 'memories'>/);
  });
});

describe('T4 врезка — captureInBackground через консервативный чат-экстрактор', () => {
  const orchSrc = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('всегда extractFromChat (флаг isV2MemQualityEnabled удалён)', () => {
    expect(orchSrc).not.toMatch(/isV2MemQualityEnabled/);
    expect(orchSrc).toMatch(/await extractFromChat\(/);
    expect(orchSrc).not.toMatch(/await extractFromTranscript\(/);
  });
});

describe('T5 врезка — details merge', () => {
  const epiSrc = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('всегда через mergeDetails (флаг удалён)', () => {
    expect(epiSrc).not.toMatch(/isV2MemQualityEnabled/);
    expect(epiSrc).toMatch(/const merged = mergeDetails\(existing\.details, details\)/);
  });
  it('импортирует mergeDetails', () => {
    expect(epiSrc).toMatch(/mergeDetails/);
  });
});

describe('T3 врезка — диктовка память через writeMemory', () => {
  const dictSrc = readFileSync(join(process.cwd(), 'src/services/dictation-service.ts'), 'utf8');
  it('зовёт writeMemory с source dictation (флаг удалён)', () => {
    expect(dictSrc).not.toMatch(/isV2MemQualityEnabled/);
    expect(dictSrc).toMatch(/writeMemory\(userId, \{[\s\S]*?source: 'dictation'/);
  });
  it('память не пишется внутри транзакции (tx.memory.create нет)', () => {
    expect(dictSrc).not.toMatch(/tx\.memory\.create\(/);
  });
});

describe('E2 врезка — значимость при чтении', () => {
  const epiSrc = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  const enrSrc = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');
  it('episodic-memory экспортирует significantMemories', () => {
    expect(epiSrc).toMatch(/export async function significantMemories\(/);
  });
  it('v2-enrichment читает significantMemories (флаг удалён)', () => {
    expect(enrSrc).not.toMatch(/isV2MemQualityEnabled/);
    expect(enrSrc).toMatch(/significantMemories\(userId, 6\)/);
    expect(enrSrc).not.toMatch(/recentEvents\(userId, 6\)/);
  });
});
