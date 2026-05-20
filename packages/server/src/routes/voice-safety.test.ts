import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 P0 voice-safety (Berik deep-review 2026-05-20):
 * структурный инвариант — /voice/process ОБЯЗАН пройти через
 * safety-gate (matchesCrisisPhrase → handleMessage) ДО
 * processVoiceCommand. Иначе голосовой кризис-сигнал минует
 * Phase 6 Safety (не получит 150/111/1303 + не пометит crisis=true).
 *
 * Refactor-proof: если кто-то уберёт гейт — тест красный.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/routes/voice.ts'),
  'utf-8',
);

describe('voice-safety — /voice/process ПРОХОДИТ через safety-gate', () => {
  it('import matchesCrisisPhrase из safety-classifier', () => {
    expect(SRC).toMatch(
      /import\s*\{\s*matchesCrisisPhrase\s*\}\s*from\s*'\.\.\/services\/safety-classifier\.js'/,
    );
  });

  it('safety-gate в /voice/process: matchesCrisisPhrase → handleMessage', () => {
    // Локализуемся в блоке /voice/process (до /voice/assistant).
    const start = SRC.indexOf("app.post('/voice/process'");
    const end = SRC.indexOf("app.post('/voice/assistant'");
    expect(start, "роут /voice/process").toBeGreaterThan(-1);
    expect(end, "роут /voice/assistant ниже").toBeGreaterThan(start);
    const block = SRC.slice(start, end);

    // matchesCrisisPhrase вызывается на text.
    expect(block).toMatch(/matchesCrisisPhrase\(text\)/);
    // На crisis-ветке делегирует handleMessage (полный путь Phase 6).
    expect(block).toMatch(
      /handleMessage\(userId,\s*text,\s*['"]voice['"]\)/,
    );
    // Гейт стоит ДО processVoiceCommand (иначе голос обходит safety).
    const gateIdx = block.indexOf('matchesCrisisPhrase(text)');
    const oldPathIdx = block.indexOf('processVoiceCommand(text)');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(oldPathIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(oldPathIdx);
  });

  it('mobile-shape сохранён: возврат {intent, response} на crisis-ветке', () => {
    const start = SRC.indexOf("app.post('/voice/process'");
    const end = SRC.indexOf("app.post('/voice/assistant'");
    const block = SRC.slice(start, end);
    // adapter под существующий shape (mobile не ломается).
    expect(block).toMatch(/intent:\s*\{\s*action:/);
    expect(block).toMatch(/response:\s*jarvis\.reply/);
  });
});
