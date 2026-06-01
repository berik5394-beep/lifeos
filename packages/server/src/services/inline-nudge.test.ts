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
