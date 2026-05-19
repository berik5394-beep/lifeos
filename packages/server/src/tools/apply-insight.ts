import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { setPendingAction } from '../services/pending-actions.js';
import { defineTool } from './_types.js';
// Цикл index↔apply-insight безопасен: эти биндинги используются
// ТОЛЬКО внутри async-handler (после инициализации модулей), не на
// module-eval — стандартный ESM-паттерн.
import { insightApplyDecision, runRegistryTool } from './index.js';

/**
 * Phase 5 P3/R8 — применить предложенное рефлектором действие.
 * SECURITY-ИНВАРИАНТ: рефлектор ПРЕДЛАГАЕТ (Insight.suggestedAction),
 * но применение НИКОГДА не обходит confirm-гейт. insightApplyDecision
 * (единый named-предикат, money-safety-style тест):
 *  reject  — действия нет в реестре → честный отказ, НИЧЕГО;
 *  confirm — деньги/внешнее (needsConfirm) → ТОЛЬКО pending, юзер
 *            подтверждает «да» (orchestrator поймает), авто-exec
 *            ЗАПРЕЩЁН (тот же инвариант, что 9B.2 agent-money);
 *  execute — обратимый → runRegistryTool (zod+аудит ToolCall).
 * needsConfirm:false у самого tool безопасно ИМЕННО потому, что
 * внутренний confirm всегда соблюдается (это и есть R8).
 */
export const applyInsightTool = defineTool({
  name: 'apply_insight',
  description:
    'Применить действие, предложенное в инсайте рефлектора (по ' +
    'insightId). Денежное/внешнее — только после явного «да».',
  category: 'system',
  schema: z.object({
    insightId: z.string().min(1).max(64),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['примени совет', 'сделай как предложил'],
  handler: async (input, ctx) => {
    const ins = await prisma.insight.findFirst({
      where: { id: input.insightId, userId: ctx.userId },
      select: { suggestedAction: true },
    });
    const sa = ins?.suggestedAction as
      | { action?: unknown; input?: unknown }
      | null
      | undefined;
    const action = typeof sa?.action === 'string' ? sa.action : '';
    const actInput =
      sa?.input && typeof sa.input === 'object'
        ? (sa.input as Record<string, unknown>)
        : {};
    if (!action) {
      return {
        applied: false,
        message: 'У этого инсайта нет предложенного действия.',
      };
    }
    const decision = insightApplyDecision(action, actInput);
    if (decision === 'reject') {
      return {
        applied: false,
        message:
          `Не могу применить: действие «${action}» неизвестно. ` +
          `Ничего не выполнил.`,
      };
    }
    if (decision === 'confirm') {
      // R8: деньги/внешнее — НИКОГДА не авто. Кладём в pending,
      // юзер подтвердит «да» (orchestrator → runConfirmedAction).
      const ctext =
        `Инсайт предлагает: «${action}». Это требует подтверждения — ` +
        `напиши «да», и выполню.`;
      await setPendingAction(ctx.userId, action, actInput, ctext);
      return {
        applied: false,
        pending: true,
        message: ctext,
      };
    }
    // execute: обратимое — через реестр (zod + аудит ToolCall).
    const out = (await runRegistryTool(action, actInput, {
      userId: ctx.userId,
    })) as { message?: string };
    return { applied: true, message: out.message ?? 'Готово.' };
  },
});
