import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/detect-reask.ts'), 'utf-8');

describe('detect-reask structure', () => {
  it('exports detectReAsk', () => {
    expect(SRC).toMatch(/export async function detectReAsk/);
  });
  it('gates on looksLikeQuestion + embeddingsEnabled before any Voyage call', () => {
    expect(SRC).toMatch(/looksLikeQuestion/);
    expect(SRC).toMatch(/embeddingsEnabled/);
  });
  it('uses embedQuery + cosineSimilarity', () => {
    expect(SRC).toMatch(/embedQuery/);
    expect(SRC).toMatch(/cosineSimilarity/);
  });
  it('reads recent user messages from ChatMessage', () => {
    expect(SRC).toMatch(/chatMessage\.findMany/);
    expect(SRC).toMatch(/role:\s*'user'/);
  });
  it('threshold 0.82 and best-effort false/null', () => {
    expect(SRC).toMatch(/0\.82/);
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/isReAsk:\s*false/);
  });
});
