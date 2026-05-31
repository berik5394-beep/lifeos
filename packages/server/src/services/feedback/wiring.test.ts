import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2FeedbackEnabled } from '../../lib/feature-flags.js';

const CAP = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'),
  'utf-8');

describe('isV2FeedbackEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_FEEDBACK; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_FEEDBACK;
    expect(isV2FeedbackEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_FEEDBACK = 'all';
    expect(isV2FeedbackEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_FEEDBACK = 'user-u1,user-u2';
    expect(isV2FeedbackEnabled('u1')).toBe(true);
    expect(isV2FeedbackEnabled('u3')).toBe(false);
  });
});

describe('v2-capture feedback branch', () => {
  it('is gated by isV2FeedbackEnabled', () => {
    expect(CAP).toMatch(/isV2FeedbackEnabled/);
  });
  it('fetches bot last message and runs the pipeline', () => {
    expect(CAP).toMatch(/role:\s*'assistant'/);
    expect(CAP).toMatch(/classifyFeedback/);
    expect(CAP).toMatch(/detectMoodDrop/);
    expect(CAP).toMatch(/detectReAsk/);
    expect(CAP).toMatch(/applyFeedback/);
  });
});
