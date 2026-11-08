import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { analyzeBudgetAfterExpense } from './_finance.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';
import { normalizeExpenseCategory } from '../lib/expense-category.js';

/**
 * SSOT Step 6 — ДЕНЬГИ. needsConfirm:true (гейт ЖИВЁТ НА ИНСТРУМЕНТЕ,
 * не в глобальном NEEDS_CONFIRM). Логика 1:1 с legacy add_expense
 * + бюджет-предупреждение. Запись идёт ТОЛЬКО после подтверждения
 * (Step 4 confirm-FSM, Postgres). Корневой фикс #1: реальная запись
 * через аудируемый реестр, а не выдумка чат-агента.
 */
const DAY_MS = 86_400_000;
/** Дата траты: YYYY-MM-DD в окне [сегодня−62 дн; сегодня], иначе сегодня (будущее/мусор не пишем). */
export function expenseDay(date: string | undefined, today: Date): Date {
  if (!date) return today;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return today;
  if (d.getTime() > today.getTime() || today.getTime() - d.getTime() > 62 * DAY_MS) return today;
  return d;
}

export const addExpenseTool = defineTool({
  name: 'add_expense',
  description:
    'Записать расход. ДЕНЬГИ — выполняется только после явного ' +
    'подтверждения пользователя («да»). Не подтверждай сам.',
  category: 'finance',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { sum: 'amount', cost: 'amount', price: 'amount', desc: 'description', note: 'description', item: 'description', title: 'description', name: 'description' },
  schema: z.object({
    amount: z.coerce.number().positive().max(MAX_MONEY_AMOUNT),
    category: z.string().max(40).optional(),
    description: z.string().max(300).optional(),
    // Дата траты (чек вчерашний, «вчера потратил») — YYYY-MM-DD, не будущее и не
    // старше ~2 мес; иначе сегодня. Раньше трата всегда ложилась на «сегодня».
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['потратил 5000 на еду', 'расход 3000 продукты', '40000 комиссия Kaspi'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // Ключ графиков/лимитов (food/transport/…). Мозг и ответ на «на что?»
    // присылают свободный текст — «еда» без нормализации график не видел.
    const category = normalizeExpenseCategory(input.category, input.description);
    // Незнакомое слово («компьютер») → «Прочее», но само слово не теряем.
    const rawCat = input.category?.trim() ?? '';
    const description =
      input.description || (category === 'other' && rawCat && !/^(other|прочее|другое)$/i.test(rawCat) ? rawCat : '');
    // R9 TZ-aware: «сегодня» в локальной TZ юзера (раньше
    // setHours(0,0,0,0) = server-local UTC midnight; для Almaty юзера
    // в 00:30 локально (= 19:30 UTC prev day) expense попадал в
    // ПРЕДЫДУЩИЙ день → wrong month aggregation для budget tools).
    const tz = await getUserTimezone(userId);
    // @db.Date = КАЛЕНДАРНАЯ дата юзера (localDateOnlyUTC). localDayStartUTC — инстант
    // локальной полуночи (Алматы: 19:00 вчера UTC) → Postgres сохранял ВЧЕРА (баг 2026-11-08).
    const today = localDateOnlyUTC(tz);
    const day = expenseDay(input.date, today);
    const expense = await prisma.expense.create({
      data: {
        userId,
        date: day,
        amount: input.amount,
        category,
        description,
      },
    });
    const analysis = await analyzeBudgetAfterExpense(userId, category);
    const when = day.getTime() !== today.getTime() ? ` за ${day.toISOString().slice(8, 10)}.${day.toISOString().slice(5, 7)}` : '';
    return {
      message: `Расход ${input.amount} ₸${when} записан${
        description ? ' (' + description + ')' : ''
      }. ${analysis.warning || ''}`.trim(),
      expenseId: expense.id,
      analysis,
    };
  },
});
