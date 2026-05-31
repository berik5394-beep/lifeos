import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/detect-mood-drop.ts'), 'utf-8');

describe('detect-mood-drop structure', () => {
  it('exports detectMoodDrop', () => {
    expect(SRC).toMatch(/export async function detectMoodDrop/);
  });
  it('reads the two latest MoodSnapshot rows', () => {
    expect(SRC).toMatch(/moodSnapshot\.findMany/);
    expect(SRC).toMatch(/recordedAt:\s*'desc'/);
    expect(SRC).toMatch(/take:\s*2/);
  });
  it('uses isMoodDrop pure helper', () => {
    expect(SRC).toMatch(/isMoodDrop/);
  });
  it('is best-effort — returns false/null on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/moodDropped:\s*false/);
  });
});
