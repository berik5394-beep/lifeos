import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { EXPENSE_LABELS, normalizeExpenseCategory } from '../lib/expense-category.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/**
 * Поставить месячный лимит бюджета на категорию (аудит-фикс MISSING).
 * Разблокирует уже-готовый читатель analyzeBudgetAfterExpense: после каждого
 * расхода бот предупреждает при превышении лимита (CLAUDE.md «умный
 * финансовый анализ»). Лимит — обратимый конфиг (upsert), не транзакция →
 * needsConfirm:false. Категория должна совпадать с категорией расходов
 * (канон: food/transport/entertainment/clothing/health/home/other).
 */
export const setBudgetTool = defineTool({
  name: 'set_budget',
  description:
    'Поставить месячный лимит бюджета на категорию расходов ' +
    '(«поставь лимит на еду 50000»). После этого бот будет предупреждать ' +
    'при превышении лимита. Категории: еда, транспорт, развлечения, одежда, ' +
    'здоровье, дом, прочее.',
  category: 'finance',
  aliases: { limit: 'monthlyLimit', amount: 'monthlyLimit', sum: 'monthlyLimit', budget: 'monthlyLimit' },
  schema: z.object({
    category: z.string().min(1).max(40).describe('категория расходов, напр. «food» (еда)'),
    monthlyLimit: z.coerce.number().positive().max(1_000_000_000).describe('лимит в ₸ на месяц'),
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['поставь лимит на еду 50000', 'лимит транспорт 30000 в месяц'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // tz-aware текущий месяц/год — чтобы совпасть с бакетингом расходов.
    const tz = await getUserTimezone(userId);
    // Месяц — по календарю юзера (localDayStartUTC = инстант полуночи: 1-го числа
    // в Алматы это ещё прошлый месяц по UTC → лимит ставился не на тот месяц).
    const [y, m] = localDateStr(tz).split('-').map(Number);
    const month = input.month ?? m;
    const year = input.year ?? y;
    // Ключ как у трат (food/housing…): раньше «еда» сохранялась как есть и
    // лимит не совпадал ни с одной тратой — предупреждения не работали.
    const category = normalizeExpenseCategory(input.category);
    await prisma.budgetLimit.upsert({
      where: { userId_category_month_year: { userId, category, month, year } },
      update: { monthlyLimit: input.monthlyLimit },
      create: { userId, category, monthlyLimit: input.monthlyLimit, month, year },
    });
    return {
      message: `Лимит на «${EXPENSE_LABELS[category] ?? category}»: ${input.monthlyLimit} ₸/мес поставлен. Предупрежу, если начнёшь превышать.`,
      category,
      monthlyLimit: input.monthlyLimit,
      month,
      year,
    };
  },
});
