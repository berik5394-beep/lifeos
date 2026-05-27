import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { analyzeBudgetAfterExpense } from './_finance.js';

/**
 * SSOT Step 6 — ДЕНЬГИ. needsConfirm:true (гейт ЖИВЁТ НА ИНСТРУМЕНТЕ,
 * не в глобальном NEEDS_CONFIRM). Логика 1:1 с legacy add_expense
 * + бюджет-предупреждение. Запись идёт ТОЛЬКО после подтверждения
 * (Step 4 confirm-FSM, Postgres). Корневой фикс #1: реальная запись
 * через аудируемый реестр, а не выдумка чат-агента.
 */
export const addExpenseTool = defineTool({
  name: 'add_expense',
  description:
    'Записать расход. ДЕНЬГИ — выполняется только после явного ' +
    'подтверждения пользователя («да»). Не подтверждай сам.',
  category: 'finance',
  schema: z.object({
    amount: z.number().positive().max(1_000_000_000),
    category: z.string().max(40).optional(),
    description: z.string().max(300).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['потратил 5000 на еду', 'расход 3000 продукты', '40000 комиссия Kaspi'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const category = input.category || 'other';
    // R9 TZ-aware: «сегодня» в локальной TZ юзера (раньше
    // setHours(0,0,0,0) = server-local UTC midnight; для Almaty юзера
    // в 00:30 локально (= 19:30 UTC prev day) expense попадал в
    // ПРЕДЫДУЩИЙ день → wrong month aggregation для budget tools).
    const tz = await getUserTimezone(userId);
    const today = localDayStartUTC(tz);
    const expense = await prisma.expense.create({
      data: {
        userId,
        date: today,
        amount: input.amount,
        category,
        description: input.description || '',
      },
    });
    const analysis = await analyzeBudgetAfterExpense(userId, category);
    return {
      message: `Расход ${input.amount} ₸ записан${
        input.description ? ' (' + input.description + ')' : ''
      }. ${analysis.warning || ''}`.trim(),
      expenseId: expense.id,
      analysis,
    };
  },
});
