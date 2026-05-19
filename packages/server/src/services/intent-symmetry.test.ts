import { describe, it, expect } from 'vitest';
import { isPlannerIntent } from './planner-service.js';
import { looksCaptureWorthy } from './jarvis-orchestrator.js';

/**
 * L99/W4 — intent-symmetry. Один источник правды «это planner-
 * команда»: isPlannerIntent (planner-service). capture-gate ОБЯЗАН
 * потреблять ЕЁ, не свой regex. Инвариант: planner-интент ⟹ НЕ
 * captureWorthy (иначе двойная-генерация — реальное дерево +
 * мусорные задачи, артефакт cmpbhm7n*). Не-planner ambient — НЕ
 * под planner-исключением. Если кто-то заведёт второй детектор —
 * этот тест покраснеет на расхождении.
 */

const PLANNER = [
  'разбей мою цель прочитать 50 книг',
  'разложи цель накопить миллион',
  'составь план под цель выучить английский',
  'как достичь цели сбросить 10 кг',
  'декомпозируй цель',
  'построй план на год',
  'распиши мою цель по неделям',
];

const NON_PLANNER = [
  'купи продукты завтра',
  'надо позвонить врачу',
  'разбить задачу на подзадачи',
  'построить дом за городом',
  'встреча с инвестором прошла хорошо',
];

describe('intent-symmetry: planner-интент ⟹ НЕ capture', () => {
  it.each(PLANNER)('«%s»: isPlannerIntent=true И capture=false', (t) => {
    expect(isPlannerIntent(t)).toBe(true);
    // симметрия по построению: looksCaptureWorthy потребляет
    // isPlannerIntent → planner-фраза НЕ извлекается в задачи.
    expect(looksCaptureWorthy(t)).toBe(false);
  });

  it.each(NON_PLANNER)(
    '«%s»: isPlannerIntent=false (не под planner-исключением)',
    (t) => {
      expect(isPlannerIntent(t)).toBe(false);
    },
  );
});
