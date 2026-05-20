import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 P0 safety-recall hardening (Berik review 2026-05-20):
 * структурный инвариант двухуровневого safety-gate.
 *
 * Tier 1 (instant): matchesCrisisPhrase В САМОМ ВЕРХУ handleMessage
 *   — детерм. phrase-net, 0 latency, 100% recall на explicit фразах.
 *
 * Tier 2 (на эмо): classifyCrisis (phrase OR Haiku) ПОСЛЕ classify-
 *   Emotional если therapeuticMode сработал — ловит non-explicit
 *   формулировки («устал существовать», «не вижу смысла продолжать»,
 *   «лучше бы меня не было»). Стоимость только на эмо-сообщениях.
 *
 * Refactor-proof: если кто-то уберёт второй tier — тест красный.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('safety-two-tier — Tier 1 (phrase) + Tier 2 (Haiku-on-emo)', () => {
  it('classifyCrisis импортирован из safety-classifier', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*classifyCrisis[^}]*\}\s*from\s*'\.\/safety-classifier\.js'/,
    );
  });

  it('Tier 1 phrase-gate СТОИТ ДО Tier 2 Haiku-gate', () => {
    const tier1 = SRC.indexOf('matchesCrisisPhrase(text)');
    const tier2 = SRC.indexOf('classifyCrisis(text)');
    expect(tier1).toBeGreaterThan(-1);
    expect(tier2).toBeGreaterThan(-1);
    expect(tier1).toBeLessThan(tier2);
  });

  it('Tier 2 вызывается ТОЛЬКО на эмо (if therapeuticMode)', () => {
    const tier2Idx = SRC.indexOf('classifyCrisis(text)');
    const slice = SRC.slice(Math.max(0, tier2Idx - 200), tier2Idx + 50);
    // Должна быть условная ветка по therapeuticMode рядом.
    expect(slice).toMatch(/if\s*\(\s*therapeuticMode\s*\)/);
  });

  it('Tier 2 при срабатывании: buildSafetyResponse + saveTurn(crisis=true) + intent safety_crisis', () => {
    const tier2Idx = SRC.indexOf('classifyCrisis(text)');
    const block = SRC.slice(tier2Idx, tier2Idx + 1200);
    expect(block).toMatch(/buildSafetyResponse\(/);
    expect(block).toMatch(/saveTurn\(userId,\s*text,\s*reply,\s*true\)/);
    expect(block).toMatch(/intent:\s*'safety_crisis'/);
  });

  it('Tier 2 имеет P1c симметрию: repeat-detect через crisis=true count', () => {
    const tier2Idx = SRC.indexOf('classifyCrisis(text)');
    const block = SRC.slice(tier2Idx, tier2Idx + 1200);
    expect(block).toMatch(/chatMessage\.count/);
    expect(block).toMatch(/crisis:\s*true/);
    expect(block).toMatch(/recentCrisisCount\s*>\s*0/);
  });
});
