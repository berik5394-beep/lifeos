import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import { createDeal, describeCreated, parseStage } from '../services/deals/index.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

export const createDealTool = defineTool({
  name: 'create_deal',
  description:
    'Завести СДЕЛКУ (продажа клиенту): «Ахмет хочет оборудование на 2 млн», «новый клиент Дана, склад». ' +
    'Сумму пиши ТОЛЬКО если юзер её назвал. Сдвиг уже существующей сделки — update_deal, не я. ' +
    'Обещание без продажи («обещал прислать») — create_obligation.',
  category: 'memory',
  aliases: { who: 'personName', client: 'personName', name: 'personName', what: 'title', sum: 'amount', due: 'nextStepDate' },
  schema: z.object({
    personName: z.string().min(1).max(120),
    title: z.string().max(200).nullable().optional(),
    amount: z.coerce.number().positive().nullable().optional(),
    stage: z.string().max(60).nullable().optional(),
    nextStepDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').nullable().optional(),
    nextStepText: z.string().max(200).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['Ахмет хочет оборудование на 2 млн', 'новая сделка с Даной — склад', 'Серик готов брать сервис, уже на переговорах'],
  handler: async (input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const stage = input.stage ? parseStage(input.stage) ?? 'new' : 'new';
    const now = new Date();
    const r = await createDeal(ctx.userId, {
      personName: input.personName,
      title: input.title ?? null,
      amount: input.amount ?? null,
      stage,
      nextStepDate: input.nextStepDate ?? null,
      nextStepText: input.nextStepText ?? null,
      note: input.note ?? null,
    }, now);
    const today = localDateStr(await getUserTimezone(ctx.userId), now);
    return { message: describeCreated(r.deal, r.taggedClient, r.step, today), dealId: r.deal.id };
  },
});
