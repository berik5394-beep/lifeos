import { z } from 'zod';
import { defineTool } from './_types.js';
import { settleObligation } from '../services/obligations/index.js';
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';

export const settleObligationTool = defineTool({
  name: 'settle_obligation',
  description:
    'Закрыть обязательство (выполнено/отдано). Вызывай на «закрой долг X», ' +
    '«я отдал X», «вернули долг». Вернули/отдал НЕ ВСЁ («вернул 200к из 500к») — ' +
    'передай amount = сколько вернули: долг уменьшится и останется открытым. ' +
    'Если это деньги — ПРЕДЛОЖИ записать доход/расход на ВОЗВРАЩЁННУЮ сумму ' +
    '(add_income/add_expense), но НЕ записывай сам — пусть юзер подтвердит.',
  category: 'memory',
  aliases: { obligation_id: 'id' },
  schema: z.object({
    id: z.string().max(64),
    amount: z.number().positive().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['закрой обязательство', 'я отдал долг Ахмету', 'вернули 500000', 'Ахмет вернул 200к из 500к'],
  handler: async (input, ctx) => {
    if (!isV2ObligationsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const settled = await settleObligation(ctx.userId, String(input.id), { paidAmount: input.amount });
    if (!settled) return { error: 'обязательство не найдено' };
    if (settled.alreadyClosed) {
      return { ok: false, alreadyClosed: true, message: `Это обязательство с ${settled.personName} уже закрыто — повторно ничего не пишу.` };
    }
    const partial = settled.remaining > 0;
    // Money: ВОЗВРАЩАЕМ предложение записать финансы (money-safe: НЕ пишем сами).
    if (settled.kind === 'money' && settled.paid) {
      const financeAction =
        settled.direction === 'owed_to_me' ? 'add_income' : 'add_expense';
      return {
        ok: true,
        settled: !partial,
        ...(partial ? { remaining: settled.remaining, message: `Записал возврат ${settled.paid}; осталось ${settled.remaining}.` } : {}),
        proposeFinance: {
          action: financeAction,
          amount: settled.paid,
          who: settled.personName,
        },
      };
    }
    return { ok: true, settled: true };
  },
});
