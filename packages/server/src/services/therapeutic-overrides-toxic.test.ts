import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildJarvisPrompt,
  type AssistantContext,
} from '../ai/jarvis-prompt.js';
import { THERAPEUTIC_STYLE_BLOCK } from '../ai/therapeutic-mode.js';

/**
 * Phase 6 C3 — HARD-ИНВАРИАНТ: therapeutic > toxic для эмо-хода
 * (locked-решение Берика). Functional + source-parse: класс
 * money-not-in-agent-loop / safety-overrides-toxic — refactor-
 * proof. Safety > всего перебивает раньше в handleMessage (C1);
 * сюда приходит НЕ-кризис.
 */

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

function ctx(style: AssistantContext['assistantStyle']): AssistantContext {
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
  };
}

describe('therapeutic-overrides-toxic — functional invariant', () => {
  it('therapeuticMode=true: THERAPEUTIC-блок присутствует, toxic-стиль НЕТ', () => {
    const p = buildJarvisPrompt(ctx('toxic'), { therapeuticMode: true });
    expect(p).toContain(THERAPEUTIC_STYLE_BLOCK);
    // токсичный стилевой маркер «саркастичный мотиватор-буллер» НЕ
    // должен быть в промте при therapeuticMode (стиль игнорируется).
    expect(p.toLowerCase()).not.toContain('саркастичный мотиватор');
  });

  it('therapeuticMode=false: STYLE применяется как обычно (toxic виден)', () => {
    const p = buildJarvisPrompt(ctx('toxic'), { therapeuticMode: false });
    expect(p).not.toContain(THERAPEUTIC_STYLE_BLOCK);
    expect(p.toLowerCase()).toContain('саркастичный мотиватор');
  });
});

describe('orchestrator routing — source invariants', () => {
  it('handleMessage классифицирует эмо ПОСЛЕ safety-гейта', () => {
    const safetyIdx = ORCH.indexOf('matchesCrisisPhrase(text)');
    const emoIdx = ORCH.indexOf('classifyEmotional(text)');
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(emoIdx).toBeGreaterThan(-1);
    expect(emoIdx).toBeGreaterThan(safetyIdx); // эмо-классификация ПОСЛЕ safety
  });

  it('therapeuticMode передаётся в buildJarvisPrompt', () => {
    expect(ORCH).toMatch(/buildJarvisPrompt\(gathered\.context,\s*\{[\s\S]*therapeuticMode[\s\S]*\}\)/);
  });

  it('fallback getAssistantReply тоже получает therapeuticMode', () => {
    expect(ORCH).toMatch(/getAssistantReply\(userId,\s*text,\s*therapeuticMode\)/);
  });
});
