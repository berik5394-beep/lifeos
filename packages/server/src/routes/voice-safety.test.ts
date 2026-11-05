import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * voice-one-brain (2026-11-05): /voice/process ЦЕЛИКОМ идёт через
 * handleMessage (safety-гейт первым, confirm-FSM, реестр, память).
 * Раньше — отдельная crisis-ветка + processVoiceCommand (второй мозг).
 */
const SRC = readFileSync(join(process.cwd(), 'src/routes/voice.ts'), 'utf-8');

function processBlock(): string {
  const start = SRC.indexOf("app.post('/voice/process'");
  const end = SRC.indexOf("app.post('/voice/assistant'");
  expect(start, 'роут /voice/process').toBeGreaterThan(-1);
  expect(end, 'роут /voice/assistant ниже').toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('voice-safety — /voice/process через единый мозг', () => {
  it('делегирует handleMessage(userId, text, "voice")', () => {
    expect(processBlock()).toMatch(/handleMessage\(userId,\s*text,\s*['"]voice['"]\)/);
  });
  it('старого второго мозга нет: processVoiceCommand/parseIntent не используются', () => {
    expect(SRC).not.toMatch(/processVoiceCommand|voice-pipeline/);
    expect(processBlock()).not.toMatch(/parseIntent/);
    expect(existsSync(join(process.cwd(), 'src/ai/voice-pipeline.ts'))).toBe(false);
  });
  it('mobile-shape сохранён + поля подтверждения', () => {
    const block = processBlock();
    expect(block).toMatch(/intent:\s*\{\s*action:/);
    expect(block).toMatch(/\bresponse[,:]/);
    expect(block).toMatch(/pendingAction:/);
    expect(block).toMatch(/confirmationText:/);
  });
});
