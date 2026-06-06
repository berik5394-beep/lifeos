import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { matchExpense, type ExpenseRef } from './_expense-match.js';

/**
 * Откат денег — удалить доход. «удали последний доход». ДЕНЬГИ →
 * needsConfirm:true. Резолв last/матч по source (реюз matchExpense:
 * source как description). Промах → throw. Кросс-домен: бюджет не трогаем
 * (доход не бюджетируется), но runway/cash-on-hand читают live-суммы →
 * удалённый доход сам отражается в следующем enrichment (короче runway).
 */
export const deleteIncomeTool = defineTool({
  name: 'delete_income',
  description:
    'Удалить доход (откат). «удали последний доход», «убери доход 50000 ' +
    'зарплата». ДЕНЬГИ — только после подтверждения «да». Не подтверждай сам.',
  category: 'finance',
  aliases: { sum: 'amount', from: 'source', src: 'source' },
  schema: z.object({
    last: z.coerce.boolean().optional(),
    amount: z.coerce.number().positive().max(1_000_000_000).optional(),
    source: z.string().max(100).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['удали последний доход', 'убери доход 50000 зарплата', 'отмени доход от фриланса'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const rows = await prisma.income.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    if (rows.length === 0) {
      throw new Error('У тебя пока нет записанных доходов — удалять нечего.');
    }
    // source кладём и в description, и в category — matchExpense ищет по обоим.
    const list: ExpenseRef[] = rows.map((i) => ({
      id: i.id,
      description: i.source,
      category: i.source,
      amount: i.amount,
    }));

    const byLast = input.last === true || (input.amount === undefined && !input.source);
    const target = byLast
      ? list[0]
      : matchExpense({ amount: input.amount, description: input.source }, list);

    if (!target) {
      const recent = list
        .slice(0, 3)
        .map((i) => `${i.amount} ₸ ${i.description}`)
        .join(', ');
      throw new Error(
        `Не нашёл такой доход. Последние: ${recent}. Какой именно убрать?`,
      );
    }

    await prisma.income.delete({ where: { id: target.id } });

    return {
      message: `Убрал доход ${target.amount} ₸${
        target.description ? ` (${target.description})` : ''
      }.`,
      deletedId: target.id,
    };
  },
});
