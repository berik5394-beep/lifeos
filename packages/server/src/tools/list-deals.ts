import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import { listDeals, describeList, salesPlanStatus, describePlan } from '../services/deals/index.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

export const listDealsTool = defineTool({
  name: 'list_deals',
  description: 'Что у меня по сделкам: открытые по стадиям с суммами, шаги на сегодня и просрочка, план продаж месяца.',
  category: 'info',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что у меня по сделкам?', 'как воронка?', 'успеваю план продаж?'],
  handler: async (_input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const now = new Date();
    const today = localDateStr(await getUserTimezone(ctx.userId), now);
    const deals = await listDeals(ctx.userId, 'open', now);
    const text = describeList(
      deals.map((d) => ({ ...d, nextStepAt: d.nextStepAt ? d.nextStepAt.toISOString().slice(0, 10) : null })),
      today,
    );
    const plan = await salesPlanStatus(ctx.userId, now);
    const planText = plan
      ? describePlan({ plan: plan.plan, won: plan.won, open: plan.open, behind: plan.pace.behind, covering: plan.covering, noAmount: plan.noAmount })
      : null;
    return { message: planText ? `${text}\n${planText}` : text };
  },
});
