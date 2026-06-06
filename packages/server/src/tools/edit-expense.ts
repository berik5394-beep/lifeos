import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { analyzeBudgetAfterExpense } from './_finance.js';
import { matchExpense, type ExpenseRef } from './_expense-match.js';

/**
 * Откат денег — исправить сумму расхода. «было 3000, стало 2000».
 * ДЕНЬГИ → needsConfirm:true. `amount` = СТАРАЯ сумма (для матча),
 * `newAmount` = новая. Резолв last/matchExpense; промах → throw.
 * Кросс-домен СРАЗУ: пересчёт бюджета в ответ. Владение через where userId.
 */
export const editExpenseTool = defineTool({
  name: 'edit_expense',
  description:
    'Исправить сумму расхода (откат/правка). «было 3000, стало 2000», ' +
    '«поправь расход на еду — 1500». ДЕНЬГИ — только после «да». Не подтверждай сам.',
  category: 'finance',
  aliases: { to: 'newAmount', new_amount: 'newAmount', sum: 'amount', cost: 'amount', desc: 'description', note: 'description' },
  schema: z.object({
    newAmount: z.coerce.number().positive().max(1_000_000_000),
    last: z.coerce.boolean().optional(),
    amount: z.coerce.number().positive().max(1_000_000_000).optional(),
    category: z.string().max(40).optional(),
    description: z.string().max(300).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['было 3000 а стало 2000', 'поправь расход на такси — 1500', 'измени последний расход на 4000'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const rows = await prisma.expense.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    if (rows.length === 0) {
      throw new Error('У тебя пока нет записанных расходов — менять нечего.');
    }
    const list: ExpenseRef[] = rows.map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category,
      amount: e.amount,
    }));

    const byLast =
      input.last === true ||
      (input.amount === undefined && !input.description && !input.category);
    const target = byLast
      ? list[0]
      : matchExpense(
          { amount: input.amount, description: input.description, category: input.category },
          list,
        );

    if (!target) {
      const recent = list
        .slice(0, 3)
        .map((e) => `${e.amount} ₸ ${e.description || e.category}`)
        .join(', ');
      throw new Error(
        `Не нашёл такой расход. Последние: ${recent}. Какой именно поправить?`,
      );
    }

    const was = target.amount;
    await prisma.expense.update({
      where: { id: target.id },
      data: { amount: input.newAmount },
    });

    // Кросс-домен: пересчёт бюджета категории ПОСЛЕ правки (живой читатель).
    const a = await analyzeBudgetAfterExpense(userId, target.category);
    const budget =
      a.budgetLimit > 0
        ? ` На ${target.category} теперь ${a.spent}/${a.budgetLimit} ₸, осталось ${Math.max(0, a.budgetLimit - a.spent)} ₸.`
        : '';

    return {
      message: `Изменил расход${
        target.description ? ` (${target.description})` : ''
      }: было ${was} ₸, стало ${input.newAmount} ₸.${budget}`.trim(),
      editedId: target.id,
    };
  },
});
