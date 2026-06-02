import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_CAPTURE_BLOCK } from './jarvis-prompt.js';

const PROMPT = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf-8');
const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);
const ASST = readFileSync(
  join(process.cwd(), 'src/services/assistant-service.ts'),
  'utf-8',
);

describe('goal-capture промпт-блок (читай между строк → записывай цель)', () => {
  it('GOAL_CAPTURE_BLOCK: записывать через suggest_goal с target/срок, между строк', () => {
    expect(GOAL_CAPTURE_BLOCK).toContain('suggest_goal');
    expect(GOAL_CAPTURE_BLOCK).toContain('target');
    expect(GOAL_CAPTURE_BLOCK).toContain('targetDate');
    expect(GOAL_CAPTURE_BLOCK).toMatch(/между строк/);
  });
  it('buildJarvisPrompt добавляет блок за opts.goalCapture', () => {
    expect(PROMPT).toContain('if (opts.goalCapture) parts.push(GOAL_CAPTURE_BLOCK)');
    expect(PROMPT).toMatch(/goalCapture\?:\s*boolean/);
  });
  it('оба call-site гейтят goalCapture флагом isV2SavingsCoachEnabled', () => {
    expect(ORCH).toContain('goalCapture: isV2SavingsCoachEnabled(userId)');
    expect(ASST).toContain('goalCapture: isV2SavingsCoachEnabled(userId)');
  });
});
