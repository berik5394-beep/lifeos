/**
 * v2 Hermes H2 — deterministic action-skill runner.
 * partitionSteps is pure (unit-tested). runSkillPlan (B3) is the two-phase
 * orchestrator. NOTE: the seed-into-agent-loop path (B4) handles skills with
 * NO confirm steps; this runner is for skills containing money/confirm steps.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { runRegistryTool, toolConfirmRequired } from '../../tools/index.js';
import { setPendingAction } from '../pending-actions.js';
import { resolveSkillArgs } from './arg-resolver.js';
import type { SkillDefinition } from '@prisma/client';
import type { SkillStep } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

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

function asMessage(out: unknown): string {
  if (out && typeof out === 'object' && 'message' in out) {
    const m = (out as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

async function synthesize(synthesisPrompt: string, parts: string[]): Promise<string> {
  const joined = parts.filter(Boolean).join('\n');
  try {
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 500,
      system: `Ты — LifeOS. Дан результат выполнения шагов навыка. Слей их в один
дружелюбный ответ по инструкции навыка. Коротко, по делу, на русском.`,
      messages: [{ role: 'user', content: `Инструкция: ${synthesisPrompt}\n\nРезультаты:\n${joined}` }],
    });
    const block = res.content[0];
    if (block && block.type === 'text' && block.text.trim()) return block.text.trim();
  } catch (err) {
    console.warn('[hermes:runner:synthesize] failed:',
      err instanceof Error ? err.message : err);
  }
  return joined || 'Готово.';
}

/**
 * Deterministic two-phase execution for an ACTION skill (has confirm steps).
 * Phase 1: run auto steps now (runRegistryTool). Phase 2: batch money/confirm
 * steps into ONE run_skill_actions PendingAction (executed after «да»).
 * Returns the user-facing reply. Best-effort throughout.
 */
export async function runSkillPlan(
  userId: string,
  skill: SkillDefinition,
  userMessage: string,
): Promise<string> {
  const plan = (skill.plan as unknown as SkillStep[]) ?? [];
  const args = await resolveSkillArgs(plan, userMessage);
  const { auto, confirm } = partitionSteps(plan, args, toolConfirmRequired);

  const parts: string[] = [];
  for (const step of auto) {
    try {
      const out = await runRegistryTool(step.toolName, step.args, { userId });
      const m = asMessage(out);
      if (m) parts.push(m);
    } catch (err) {
      console.warn(`[hermes:runner:auto:${step.toolName}] failed:`,
        err instanceof Error ? err.message : err);
    }
  }

  let message = await synthesize(skill.synthesis, parts);

  if (confirm.length > 0) {
    const list = confirm
      .map((s) => `${s.toolName}(${JSON.stringify(s.args)})`)
      .join(', ');
    const confirmationText = `Навык «${skill.name}»: подтвердить действия — ${list}? (да/нет)`;
    try {
      await setPendingAction(
        userId,
        'run_skill_actions',
        { steps: confirm, skillName: skill.name },
        confirmationText,
      );
      message = `${message}\n\n⚠️ ${confirmationText}`;
    } catch (err) {
      console.warn('[hermes:runner:pending] failed:', err);
    }
  }
  return message;
}
