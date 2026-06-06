import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { analyzeBudgetAfterExpense } from './_finance.js';
import { matchExpense, type ExpenseRef } from './_expense-match.js';

/**
 * Откат денег из чата — удалить расход. ДЕНЬГИ → needsConfirm:true
 * (исполняется ТОЛЬКО после «да», как add_expense). Резолв: last по дате
 * или fuzzy-матч (matchExpense). Промах → throw (честно переспросит, не
 * удалит наугад). Кросс-домен СРАЗУ: после удаления — пересчёт бюджета в ответ.
 * Владение: выборка where userId → удаляем только свой расход (без IDOR).
 */
export const deleteExpenseTool = defineTool({
  name: 'delete_expense',
  description:
    'Удалить расход (откат). «удали последний расход», «убери расход 5000 ' +
    'на еду». ДЕНЬГИ — только после подтверждения «да». Не подтверждай сам.',
  category: 'finance',
  aliases: { sum: 'amount', cost: 'amount', desc: 'description', note: 'description', item: 'description' },
  schema: z.object({
    last: z.coerce.boolean().optional(),
    amount: z.coerce.number().positive().max(1_000_000_000).optional(),
    category: z.string().max(40).optional(),
    description: z.string().max(300).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['удали последний расход', 'убери расход 5000 на еду', 'отмени трату на такси'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const rows = await prisma.expense.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    if (rows.length === 0) {
      throw new Error('У тебя пока нет записанных расходов — удалять нечего.');
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
        `Не нашёл такой расход. Последние: ${recent}. Какой именно убрать?`,
      );
    }

    await prisma.expense.delete({ where: { id: target.id } });

    // Кросс-домен: пересчёт бюджета категории ПОСЛЕ удаления (живой читатель).
    const a = await analyzeBudgetAfterExpense(userId, target.category);
    const budget =
      a.budgetLimit > 0
        ? ` На ${target.category} теперь ${a.spent}/${a.budgetLimit} ₸, осталось ${Math.max(0, a.budgetLimit - a.spent)} ₸.`
        : '';

    return {
      message: `Убрал расход ${target.amount} ₸${
        target.description ? ` (${target.description})` : ''
      }.${budget}`.trim(),
      deletedId: target.id,
    };
  },
});
