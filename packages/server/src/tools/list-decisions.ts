import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * Решения юзера: что ждёт проверки исхода и чем закончились прошлые.
 * Раньше были только log_decision/review_decision (запись) — список
 * «какие решения я принимал» мозг прочитать не мог.
 */
export const listDecisionsTool = defineTool({
  name: 'list_decisions',
  description:
    'Решения юзера: открытые (ждут проверки, с датой проверки и ожидаемым итогом) и последние проверенные (вердикт). ' +
    'Вызывай на «какие решения я принимал», «что там с моим решением про X», «какие решения пора проверить».',
  category: 'memory',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['какие решения я принимал', 'что пора проверить из решений'],
  handler: async (_input, ctx) => {
    const [open, reviewed] = await Promise.all([
      prisma.decision.findMany({
        where: { userId: ctx.userId, status: 'open' },
        orderBy: { reviewDate: 'asc' },
        select: { title: true, expectedOutcome: true, reviewDate: true, decidedAt: true },
        take: 15,
      }),
      prisma.decision.findMany({
        where: { userId: ctx.userId, status: { not: 'open' } },
        orderBy: { reviewedAt: 'desc' },
        select: { title: true, verdict: true, actualOutcome: true, reviewedAt: true },
        take: 5,
      }),
    ]);
    return {
      open: open.map((d) => ({
        title: d.title,
        expected: d.expectedOutcome,
        reviewDate: d.reviewDate.toISOString().slice(0, 10),
        decidedAt: d.decidedAt.toISOString().slice(0, 10),
      })),
      reviewed: reviewed.map((d) => ({
        title: d.title,
        verdict: d.verdict,
        outcome: d.actualOutcome,
        reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString().slice(0, 10) : null,
      })),
    };
  },
});
