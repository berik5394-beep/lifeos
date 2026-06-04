import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2DecisionsEnabled } from '../lib/feature-flags.js';
import { defineTool } from './_types.js';

const DAY_MS = 86_400_000;

/**
 * Зафиксировать решение + ожидаемый исход + дату проверки. needsConfirm:true.
 * Пишет ТОЛЬКО Decision (не денежный ledger). Дефолт reviewDate = +90 дней.
 */
export const logDecisionTool = defineTool({
  name: 'log_decision',
  description:
    'Записать важное решение пользователя (что решил, что ожидает, когда ' +
    'проверить). Позже ассистент вернётся спросить, как вышло. Выполняется ' +
    'только после явного подтверждения. Не подтверждай сам.',
  category: 'memory',
  aliases: { decision: 'title', что: 'title', ожидаю: 'expectedOutcome', expect: 'expectedOutcome' },
  schema: z.object({
    title: z.string().min(1).max(240),
    expectedOutcome: z.string().max(500).optional(),
    reviewDate: z.string().optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['реши: беру поставщика A, ожидаю −15% себестоимости, проверь через месяц'],
  handler: async (input, ctx) => {
    if (!isV2DecisionsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const tz = await getUserTimezone(ctx.userId);
    const today = localDayStartUTC(tz);
    let reviewDate = new Date(today.getTime() + 90 * DAY_MS);
    if (input.reviewDate) {
      const d = new Date(input.reviewDate);
      if (!Number.isNaN(d.getTime())) reviewDate = d;
    }
    await prisma.decision.create({
      data: {
        userId: ctx.userId,
        title: input.title,
        expectedOutcome: input.expectedOutcome ?? null,
        reviewDate,
        status: 'open',
        source: 'manual',
      },
    });
    return {
      message: `Записал решение «${input.title}». Вернусь ${reviewDate
        .toISOString()
        .slice(0, 10)} спросить, как вышло.`,
    };
  },
});
