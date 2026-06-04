import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isV2DecisionsEnabled } from '../lib/feature-flags.js';
import { defineTool } from './_types.js';

/**
 * Зафиксировать фактический исход ранее записанного решения + вердикт.
 * Вердикт ассистент ВЫВОДИТ из текста ретро и предлагает; юзер подтверждает.
 * needsConfirm:true. Пишет ТОЛЬКО Decision.
 */
export const reviewDecisionTool = defineTool({
  name: 'review_decision',
  description:
    'Зафиксировать, как вышло ранее записанное решение, и вердикт ' +
    '(worked/didnt/mixed). Вердикт определи из слов пользователя и предложи. ' +
    'Выполняется только после явного подтверждения.',
  category: 'memory',
  aliases: { что: 'title', outcome: 'actualOutcome', result: 'actualOutcome' },
  schema: z.object({
    title: z.string().min(1),
    actualOutcome: z.string().min(1).max(500),
    verdict: z.enum(['worked', 'didnt', 'mixed']),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['поставщик A сработал, себестоимость −12%'],
  handler: async (input, ctx) => {
    if (!isV2DecisionsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const found = await prisma.decision.findFirst({
      where: {
        userId: ctx.userId,
        status: 'open',
        title: { contains: input.title, mode: 'insensitive' },
      },
      orderBy: { decidedAt: 'desc' },
    });
    if (!found) return { error: 'не нашёл такое открытое решение' };
    await prisma.decision.update({
      where: { id: found.id },
      data: {
        status: 'reviewed',
        reviewedAt: new Date(),
        actualOutcome: input.actualOutcome,
        verdict: input.verdict,
      },
    });
    const label =
      input.verdict === 'worked'
        ? 'сработало ✅'
        : input.verdict === 'didnt'
          ? 'не вышло ❌'
          : 'частично ⚖️';
    return { message: `Записал исход «${found.title}»: ${label}.` };
  },
});
