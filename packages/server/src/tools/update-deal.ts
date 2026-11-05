import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import {
  findOpenDeals, updateDeal, describeUpdated, parseStage, genitive, instrumental, DEAL_INCOME_ACTION, fmtMoney,
} from '../services/deals/index.js';
import { setPendingAction } from '../services/pending-actions.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

export const updateDealTool = defineTool({
  name: 'update_deal',
  description:
    'Сдвинуть СУЩЕСТВУЮЩУЮ сделку: стадия («отправил КП», «договор», «оплатил», «отказался»), сумма, ' +
    'следующий шаг («перезвонить Ахмету во вторник» при открытой сделке с ним — это я, а не create_task), заметка. ' +
    '«Обещал прислать КП до пятницы» (обещание) — create_obligation, не я. «Получил деньги от клиента» по сделке — ' +
    'я ставлю «выиграна» и предлагаю доход; голый add_income не зови, чтобы не задвоить.',
  category: 'memory',
  aliases: { who: 'personName', client: 'personName', name: 'personName', what: 'title', sum: 'amount', due: 'nextStepDate', reason: 'lostReason' },
  schema: z.object({
    personName: z.string().min(1).max(120),
    title: z.string().max(200).nullable().optional(),
    stage: z.string().max(60).nullable().optional(),
    amount: z.coerce.number().positive().nullable().optional(),
    nextStepDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').nullable().optional(),
    nextStepText: z.string().max(200).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    lostReason: z.string().max(300).nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отправил Ахмету КП', 'Ахмет оплатил', 'Серик отказался, дорого', 'перезвонить Ахмету во вторник'],
  handler: async (input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'deals_disabled', hint: 'сделки выключены — для напоминания используй create_task, для обещания create_obligation' };
    const name = input.personName.trim();
    const found = await findOpenDeals(ctx.userId, name, input.title ?? null);
    if (found.length === 0) {
      return { message: `С ${instrumental(name)} открытых сделок нет. Завести новую?` };
    }
    if (found.length > 1) {
      const list = found.map((d) => `«${d.title}»${d.amount != null ? ` (${fmtMoney(d.amount)})` : ''}`).join(', ');
      return { message: `У ${genitive(name)} ${found.length} открытые сделки: ${list}. Про какую?` };
    }
    const stage = input.stage ? parseStage(input.stage) : null;
    if (input.stage && !stage) return { message: `Не понял стадию «${input.stage}». Варианты: новая, переговоры, КП, договор, выиграна, проиграна.` };
    const now = new Date();
    const r = await updateDeal(ctx.userId, found[0].id, {
      ...(stage ? { stage } : {}),
      ...(input.amount != null ? { amount: input.amount } : {}),
      nextStepDate: input.nextStepDate ?? null,
      nextStepText: input.nextStepText ?? null,
      note: input.note ?? null,
      lostReason: input.lostReason ?? null,
    }, now);
    const today = localDateStr(await getUserTimezone(ctx.userId), now);
    const message = describeUpdated(r.deal, r, today);
    if (r.incomeOffer) await setPendingAction(ctx.userId, DEAL_INCOME_ACTION, { dealId: r.deal.id }, message);
    return { message, dealId: r.deal.id };
  },
});
