import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 voice-stack invariant (Berik close-out 2026-05-20):
 * /voice/conversation/{message,text} ОБЯЗАНЫ идти через handleMessage
 * — там оба tiers safety (Tier 1 phrase + Tier 2 Haiku-on-emo) +
 * Phase 6 therapeutic + opt-out + crisis-isolation. Если завтра
 * кто-то введёт параллельный мозг или прямой Claude — этот тест
 * красный.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/routes/conversation.ts'),
  'utf-8',
);

describe('voice-conversation routes — единый мозг (no drift)', () => {
  it('import handleMessage из orchestrator', () => {
    expect(SRC).toMatch(
      /import\s*\{\s*handleMessage\s*\}\s*from\s*'\.\.\/services\/jarvis-orchestrator\.js'/,
    );
  });

  it('/voice/conversation/message: audio → transcribe → handleMessage', () => {
    const start = SRC.indexOf("app.post('/voice/conversation/message'");
    const end = SRC.indexOf("app.post('/voice/conversation/text'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = SRC.slice(start, end);
    expect(block).toMatch(/transcribeAudio\(/);
    expect(block).toMatch(/handleMessage\(userId,\s*text,\s*['"]voice['"]\)/);
  });

  it('/voice/conversation/text: → handleMessage (без channel)', () => {
    const start = SRC.indexOf("app.post('/voice/conversation/text'");
    const end = SRC.indexOf("app.post('/voice/conversation/end'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = SRC.slice(start, end);
    expect(block).toMatch(/handleMessage\(userId,\s*text\)/);
  });
});
