import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildJarvisPrompt,
  type AssistantContext,
} from '../ai/jarvis-prompt.js';
import { THERAPEUTIC_STYLE_BLOCK } from '../ai/therapeutic-mode.js';

/**
 * Phase 6 C5 — HARD-инвариант opt-out (спека-провал-инвариант:
 * пользователь с therapeuticMode:false получает ТОЛЬКО транзакционные
 * ответы, даже на эмо-фразы). Functional + source-parse.
 */

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);
const SVC = readFileSync(
  join(process.cwd(), 'src/services/therapeutic-detector-service.ts'),
  'utf-8',
);

function ctx(
  style: AssistantContext['assistantStyle'],
  therapeuticMode?: boolean,
): AssistantContext {
  return {
    userName: 'Test',
    assistantStyle: style,
    assistantGender: 'female',
    todayTasks: [],
    habitsProgress: { total: 0, completed: 0 },
    upcomingEvents: [],
    spentThisMonth: 0,
    budgetLimit: 0,
    currentStreak: 0,
    weekProgress: 0,
    yearlyGoalsSummary: 'Не заданы',
    therapeuticMode,
  };
}

describe('opt-out functional invariant', () => {
  it('при opts.therapeuticMode=false → THERAPEUTIC-блок НЕ применяется', () => {
    // Здесь ctx.therapeuticMode (preference) не важен — orchestrator
    // AND-gates: finalTherapeutic = emo && optIn. Если orchestrator
    // передал therapeuticMode:false (opt-out OR не-эмо), promptт обычный.
    const p = buildJarvisPrompt(ctx('toxic', false), { therapeuticMode: false });
    expect(p).not.toContain(THERAPEUTIC_STYLE_BLOCK);
  });
});

describe('opt-out source invariants', () => {
  it('orchestrator AND-gate: optIn = ctx.therapeuticMode !== false', () => {
    expect(ORCH).toMatch(/optIn\s*=\s*gathered\?\.context\.therapeuticMode\s*!==\s*false/);
    expect(ORCH).toMatch(/finalTherapeutic\s*=\s*therapeuticMode\s*&&\s*optIn/);
  });
  it('orchestrator передаёт finalTherapeutic (не сырой emo) в prompt', () => {
    expect(ORCH).toMatch(
      /therapeuticMode:\s*finalTherapeutic/,
    );
  });
  it('detector-service: opt-out юзер → early return, БЕЗ Sonnet/persist', () => {
    expect(SVC).toMatch(
      /user\.therapeuticMode\s*===\s*false[\s\S]{0,80}return\s*\{\s*ran:\s*false/,
    );
  });
});
