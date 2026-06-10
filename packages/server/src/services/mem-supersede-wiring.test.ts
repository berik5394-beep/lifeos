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
