import { z } from 'zod';
import { defineTool } from './_types.js';
import { settleObligation } from '../services/obligations/index.js';
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';

export const settleObligationTool = defineTool({
  name: 'settle_obligation',
  description:
    'Закрыть обязательство (выполнено/отдано). Вызывай на «закрой долг X», ' +
    '«я отдал X», «вернули долг». Если это деньги — ПРЕДЛОЖИ записать доход/расход ' +
    '(add_income/add_expense), но НЕ записывай сам — пусть юзер подтвердит.',
  category: 'memory',
  aliases: { obligation_id: 'id' },
  schema: z.object({ id: z.string().max(64) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['закрой обязательство', 'я отдал долг Ахмету', 'вернули 500000'],
  handler: async (input, ctx) => {
    if (!isV2ObligationsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const settled = await settleObligation(ctx.userId, String(input.id));
    if (!settled) return { error: 'обязательство не найдено' };
    // Money: ВОЗВРАЩАЕМ предложение записать финансы (money-safe: НЕ пишем сами).
    if (settled.kind === 'money' && settled.amount) {
      const financeAction =
        settled.direction === 'owed_to_me' ? 'add_income' : 'add_expense';
      return {
        ok: true,
        settled: true,
        proposeFinance: {
          action: financeAction,
          amount: settled.amount,
          who: settled.personName,
        },
      };
    }
    return { ok: true, settled: true };
  },
});
