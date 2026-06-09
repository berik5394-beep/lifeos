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

describe('T4 врезка — captureInBackground выбирает экстрактор по флагу', () => {
  const orchSrc = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('флаг-тернар extractFromChat / extractFromTranscript', () => {
    expect(orchSrc).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(orchSrc).toMatch(/\?\s*await extractFromChat\(/);
    expect(orchSrc).toMatch(/:\s*await extractFromTranscript\(/);
  });
  it('импортирует extractFromChat и isV2MemQualityEnabled', () => {
    expect(orchSrc).toMatch(/extractFromChat/);
    expect(orchSrc).toMatch(/isV2MemQualityEnabled/);
  });
});

describe('T5 врезка — details merge по флагу', () => {
  const epiSrc = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('ON-ветка через mergeDetails, OFF-ветка details ?? existing.details', () => {
    expect(epiSrc).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(epiSrc).toMatch(/\?\s*mergeDetails\(existing\.details, details\)/);
    expect(epiSrc).toMatch(/:\s*\(details \?\? existing\.details\)/);
  });
  it('импортирует mergeDetails', () => {
    expect(epiSrc).toMatch(/mergeDetails/);
  });
});

describe('T3 врезка — диктовка память через writeMemory по флагу', () => {
  const dictSrc = readFileSync(join(process.cwd(), 'src/services/dictation-service.ts'), 'utf8');
  it('ON-ветка зовёт writeMemory с source dictation', () => {
    expect(dictSrc).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(dictSrc).toMatch(/writeMemory\(userId, \{[\s\S]*?source: 'dictation'/);
  });
  it('OFF-ветка сохраняет tx.memory.create', () => {
    expect(dictSrc).toMatch(/tx\.memory\.create\(/);
  });
});

describe('E2 врезка — значимость при чтении по флагу', () => {
  const epiSrc = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  const enrSrc = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');
  it('episodic-memory экспортирует significantMemories', () => {
    expect(epiSrc).toMatch(/export async function significantMemories\(/);
  });
  it('v2-enrichment выбирает significantMemories / recentEvents по флагу', () => {
    expect(enrSrc).toMatch(/isV2MemQualityEnabled\(userId\)/);
    expect(enrSrc).toMatch(/significantMemories\(userId, 6\)/);
    expect(enrSrc).toMatch(/recentEvents\(userId, 6\)/);
  });
});
