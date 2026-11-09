import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import {
  findOpenDeals, findRecentClosedDeals, isOpenStage, updateDeal, describeUpdated, describeWhichDeal, parseStage, DEAL_INCOME_ACTION,
} from '../services/deals/index.js';
import { fmtMoneyExact } from '../services/deals/index.js';
import { setPendingAction } from '../services/pending-actions.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';

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
    amount: z.coerce.number().positive().max(MAX_MONEY_AMOUNT).nullable().optional(),
    nextStepDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').nullable().optional(),
    nextStepText: z.string().max(200).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    lostReason: z.string().max(300).nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отправил Ахмету КП', 'Ахмет оплатил', 'Серик отказался, дорого', 'перезвонить Ахмету во вторник'],
  handler: async (input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'deals_disabled', hint: 'сделки выключены — для напоминания используй create_task, для обещания create_obligation, полученные деньги — add_income' };
    const name = input.personName.trim();
    const stage = input.stage ? parseStage(input.stage) : null;
    if (input.stage && !stage) return { message: `Не понял стадию «${input.stage}». Варианты: новая, переговоры, КП, договор, выиграна, проиграна.`, needsInput: true };
    let found = await findOpenDeals(ctx.userId, name, input.title ?? null);
    // Ревью I3: открытых нет, но названа сумма или открытая стадия — это может быть
    // недавно закрытая сделка («выиграна» без суммы / вернуть проигранную в работу).
    if (found.length === 0 && (input.amount != null || (stage && isOpenStage(stage)))) {
      const closed = await findRecentClosedDeals(ctx.userId, name, input.title ?? null);
      if (closed.length === 1) found = closed;
    }
    if (found.length === 0) {
      // Ревью I5: не вопрос юзеру, а подсказка агенту — иначе «перезвонить Дане» без сделки теряется.
      return {
        error: 'no_open_deal',
        hint: 'у этого человека нет открытой сделки — если это просто напоминание, используй create_task; если новая продажа — create_deal',
      };
    }
    if (found.length > 1) return { message: describeWhichDeal(found[0].personName, found), needsInput: true };
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
    const message =
      describeUpdated(r.deal, r, today) +
      (r.leftIncome ? ` Доход ${fmtMoneyExact(r.leftIncome.amount)} по этой сделке остался в финансах — скажи «убери этот доход», если он не пришёл.` : '');
    if (r.incomeOffer) await setPendingAction(ctx.userId, DEAL_INCOME_ACTION, { dealId: r.deal.id }, message);
    return { message, dealId: r.deal.id };
  },
});
