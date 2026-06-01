import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLAGS = readFileSync(join(process.cwd(), 'src/lib/feature-flags.ts'), 'utf8');

describe('D — inline-nudge feature flag', () => {
  it('exports isV2InlineNudgeEnabled using FEATURE_V2_INLINE_NUDGE', () => {
    expect(FLAGS).toMatch(/export function isV2InlineNudgeEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_INLINE_NUDGE/);
    expect(FLAGS).toMatch(/isEnabledForUser\(process\.env\.FEATURE_V2_INLINE_NUDGE, userId\)/);
  });
});

describe('D — inline nudge prompt block', () => {
  const PROMPT = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf8');
  const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf8');
  it('jarvis-prompt has INLINE_NUDGE_BLOCK gated by opts.inlineNudge', () => {
    expect(PROMPT).toMatch(/INLINE_NUDGE_BLOCK/);
    expect(PROMPT).toMatch(/opts\.inlineNudge/);
  });
  it('orchestrator passes inlineNudge: isV2InlineNudgeEnabled(userId)', () => {
    expect(ORCH).toMatch(/inlineNudge:\s*isV2InlineNudgeEnabled\(userId\)/);
    expect(ORCH).toMatch(/isV2InlineNudgeEnabled/);
  });
});
