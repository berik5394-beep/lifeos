import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildJarvisPrompt, OBLIGATION_CAPTURE_BLOCK } from './jarvis-prompt.js';
import type { AssistantContext } from './jarvis-prompt.js';

const ctx: AssistantContext = {
  userName: 'Берик',
  assistantStyle: 'friendly',
  assistantGender: 'male',
  todayTasks: [],
  habitsProgress: { total: 0, completed: 0 },
  upcomingEvents: [],
  spentThisMonth: 0,
  budgetLimit: 0,
  currentStreak: 0,
  weekProgress: 0,
  yearlyGoalsSummary: '',
};

describe('obligation auto-capture prompt block', () => {
  it('блок добавляется ТОЛЬКО при obligationCapture=true (off → байт-идентично)', () => {
    const off = buildJarvisPrompt(ctx, {});
    const on = buildJarvisPrompt(ctx, { obligationCapture: true });
    expect(off).not.toContain('ОБЯЗАТЕЛЬСТВА — ЛОВИ');
    expect(on).toContain('ОБЯЗАТЕЛЬСТВА — ЛОВИ');
    expect(on).toContain('create_obligation');
  });

  it('блок: предложить (не молча), оба направления, money-settle', () => {
    expect(OBLIGATION_CAPTURE_BLOCK).toContain('ПРЕДЛОЖИ');
    expect(OBLIGATION_CAPTURE_BLOCK).toContain('я должен');
    expect(OBLIGATION_CAPTURE_BLOCK).toContain('мне должны');
    expect(OBLIGATION_CAPTURE_BLOCK).toContain('settle_obligation');
  });

  it('orchestrator гейтит блок флагом isV2ObligationsEnabled', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
      'utf-8',
    );
    expect(src).toMatch(/obligationCapture:\s*isV2ObligationsEnabled\(userId\)/);
  });
});
