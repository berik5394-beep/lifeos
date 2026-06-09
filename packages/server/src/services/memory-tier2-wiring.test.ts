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
