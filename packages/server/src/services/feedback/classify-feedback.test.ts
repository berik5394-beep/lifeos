import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/classify-feedback.ts'), 'utf-8');

describe('classify-feedback structure', () => {
  it('exports classifyFeedback', () => {
    expect(SRC).toMatch(/export async function classifyFeedback/);
  });
  it('uses haiku model', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
  });
  it('feeds bot message, user message and implicit flags into the prompt', () => {
    expect(SRC).toMatch(/\[БОТ\]/);
    expect(SRC).toMatch(/\[ЮЗЕР\]/);
    expect(SRC).toMatch(/moodDropped/);
    expect(SRC).toMatch(/isReAsk/);
  });
  it('parses via parseFeedbackResponse', () => {
    expect(SRC).toMatch(/parseFeedbackResponse/);
  });
  it('is best-effort — returns NO_REACTION on failure, never throws', () => {
    expect(SRC).toMatch(/NO_REACTION/);
    expect(SRC).toMatch(/catch/);
  });
  it('names the four axes in the system prompt', () => {
    for (const a of ['conflict_tolerance', 'introspection_depth',
                     'emotional_openness', 'self_discipline']) {
      expect(SRC).toContain(a);
    }
  });
});
