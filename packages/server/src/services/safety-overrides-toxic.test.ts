import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesCrisisPhrase } from './safety-classifier.js';
import { buildSafetyResponse } from './safety-response.js';

/**
 * Phase 6 C1 — HARD-ИНВАРИАНТ (gate 2): Safety перебивает ЛЮБОЙ
 * стиль, включая toxic. Тот же класс защиты, что
 * money-not-in-agent-loop из 9A.8 — структурная проверка исходника,
 * НЕ «правило в промпте». Невозможно пройти случайно при будущем
 * рефакторинге: если кто-то поднимет стиль/агента/pending ВЫШЕ
 * safety-гейта — этот тест станет красным.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('safety-overrides-toxic — структурный инвариант', () => {
  it('buildSafetyResponse style-agnostic by construction (arity 0)', () => {
    // toxic/любой стиль ФИЗИЧЕСКИ нельзя передать в safety-ответ.
    expect(buildSafetyResponse.length).toBe(0);
  });

  it('safety-гейт стоит ДО стиля/агента/pending в handleMessage', () => {
    const gate = SRC.indexOf('matchesCrisisPhrase(text)');
    expect(gate, 'safety-гейт присутствует').toBeGreaterThan(-1);
    for (const after of [
      'peekPendingAction(userId)', // pending-confirm
      'buildJarvisPrompt(', // ЯДРО+СТИЛЬ
      'runAgent(', // агент-цикл
    ]) {
      const idx = SRC.indexOf(after);
      expect(idx, `${after} существует`).toBeGreaterThan(-1);
      expect(
        gate,
        `safety-гейт ДОЛЖЕН быть раньше «${after}» (иначе toxic/стиль ` +
          `может ответить на кризис до safety)`,
      ).toBeLessThan(idx);
    }
  });

  it('кризис-гейт возвращает именно safety-ответ (не стиль)', () => {
    // В исходнике ветка кризиса формирует reply из buildSafetyResponse,
    // а не из стиля/агента.
    const gateBlock = SRC.slice(
      SRC.indexOf('matchesCrisisPhrase(text)'),
      SRC.indexOf('matchesCrisisPhrase(text)') + 320,
    );
    expect(gateBlock).toMatch(/buildSafetyResponse\(\)/);
    expect(gateBlock).toMatch(/saveTurn\(userId, text, reply, true\)/);
    expect(gateBlock).toMatch(/intent:\s*'safety_crisis'/);
  });

  it('recall не зависит от стиля: кризис ловится всегда', () => {
    for (const p of [
      'я хочу умереть',
      'хочу покончить с собой',
      'я режу себя',
    ]) {
      expect(matchesCrisisPhrase(p)).toBe(true);
    }
  });
});
