/**
 * v2 Hermes H2 — deterministic action-skill runner.
 * partitionSteps is pure (unit-tested). runSkillPlan (B3) is the two-phase
 * orchestrator. NOTE: the seed-into-agent-loop path (B4) handles skills with
 * NO confirm steps; this runner is for skills containing money/confirm steps.
 */

import type { SkillStep } from './types.js';

export interface RunnerStep {
  toolName: string;
  args: Record<string, unknown>;
}

/** Split steps into `auto` (needsConfirm false) and `confirm` (needsConfirm
 *  true), preserving order, pairing each step with its resolved args by index. */
export function partitionSteps(
  plan: SkillStep[],
  args: Record<string, unknown>[],
  needsConfirmOf: (toolName: string, args: Record<string, unknown>) => boolean,
): { auto: RunnerStep[]; confirm: RunnerStep[] } {
  const auto: RunnerStep[] = [];
  const confirm: RunnerStep[] = [];
  plan.forEach((step, i) => {
    const a = args[i] && typeof args[i] === 'object' ? args[i] : {};
    const rs: RunnerStep = { toolName: step.toolName, args: a };
    if (needsConfirmOf(step.toolName, a)) confirm.push(rs);
    else auto.push(rs);
  });
  return { auto, confirm };
}
