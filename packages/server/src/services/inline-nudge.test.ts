import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLAGS = readFileSync(join(process.cwd(), 'src/lib/feature-flags.ts'), 'utf8');

describe('D — inline-nudge: флаг удалён', () => {
  it('FEATURE_V2_INLINE_NUDGE больше не читается', () => {
    expect(FLAGS).not.toMatch(/isV2InlineNudgeEnabled/);
    expect(FLAGS).not.toMatch(/FEATURE_V2_INLINE_NUDGE/);
  });
});

describe('D — inline nudge prompt block', () => {
  const PROMPT = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf8');
  const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('jarvis-prompt has INLINE_NUDGE_BLOCK gated by opts.inlineNudge', () => {
    expect(PROMPT).toMatch(/INLINE_NUDGE_BLOCK/);
    expect(PROMPT).toMatch(/opts\.inlineNudge/);
  });
  it('orchestrator всегда передаёт inlineNudge: true', () => {
    expect(ORCH).not.toMatch(/isV2InlineNudgeEnabled/);
    expect(ORCH).toMatch(/inlineNudge:\s*true/);
  });
});
