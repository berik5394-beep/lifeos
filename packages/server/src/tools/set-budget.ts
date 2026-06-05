import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
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
    const localDay = localDayStartUTC(tz);
    const month = input.month ?? localDay.getUTCMonth() + 1;
    const year = input.year ?? localDay.getUTCFullYear();
    const category = input.category;
    await prisma.budgetLimit.upsert({
      where: { userId_category_month_year: { userId, category, month, year } },
      update: { monthlyLimit: input.monthlyLimit },
      create: { userId, category, monthlyLimit: input.monthlyLimit, month, year },
    });
    return {
      message: `Лимит на «${category}»: ${input.monthlyLimit} ₸/мес поставлен. Предупрежу, если начнёшь превышать.`,
      category,
      monthlyLimit: input.monthlyLimit,
      month,
      year,
    };
  },
});
