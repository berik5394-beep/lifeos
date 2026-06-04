import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { logDecisionTool } from './log-decision.js';
import { reviewDecisionTool } from './review-decision.js';

const LOG = readFileSync(join(__dirname, 'log-decision.ts'), 'utf8');
const REV = readFileSync(join(__dirname, 'review-decision.ts'), 'utf8');

describe('decision tools — money-safety', () => {
  it('log_decision: needsConfirm + write + flag-gated', () => {
    expect(logDecisionTool.name).toBe('log_decision');
    expect(logDecisionTool.needsConfirm).toBe(true);
    expect(logDecisionTool.sideEffects).toBe('write');
    expect(LOG).toMatch(/isV2DecisionsEnabled\(ctx\.userId\)/);
  });
  it('review_decision: needsConfirm + write + flag-gated', () => {
    expect(reviewDecisionTool.name).toBe('review_decision');
    expect(reviewDecisionTool.needsConfirm).toBe(true);
    expect(reviewDecisionTool.sideEffects).toBe('write');
    expect(REV).toMatch(/isV2DecisionsEnabled\(ctx\.userId\)/);
  });
  it('write only Decision (no income/expense)', () => {
    for (const s of [LOG, REV]) {
      expect(s).not.toMatch(/prisma\.(income|expense)\.(create|update)/);
    }
    expect(LOG).toMatch(/decision\.create/);
    expect(REV).toMatch(/decision\.update/);
  });
});

describe('decision tools — registry', () => {
  it('both registered in tools/index.ts', () => {
    const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(idx).toMatch(/logDecisionTool/);
    expect(idx).toMatch(/reviewDecisionTool/);
  });
});
