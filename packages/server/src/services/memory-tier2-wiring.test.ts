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
