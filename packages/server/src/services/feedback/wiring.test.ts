import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAP = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'),
  'utf-8');

describe('v2-capture feedback branch', () => {
  it('без флага (isV2FeedbackEnabled удалён)', () => {
    expect(CAP).not.toMatch(/isV2FeedbackEnabled/);
  });
  it('fetches bot last message and runs the pipeline', () => {
    expect(CAP).toMatch(/role:\s*'assistant'/);
    expect(CAP).toMatch(/classifyFeedback/);
    expect(CAP).toMatch(/detectMoodDrop/);
    expect(CAP).toMatch(/detectReAsk/);
    expect(CAP).toMatch(/applyFeedback/);
  });
});
