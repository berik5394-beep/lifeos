import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/**
 * Массово перенести ВСЕ просроченные задачи (date < сегодня, не выполнены,
 * не отменены) на сегодня. Вызывай на «перенеси все просроченные на сегодня».
 * needsConfirm — операция массовая (меняет даты).
 */
export const deferOverdueTool = defineTool({
  name: 'defer_overdue',
  description:
    'Перенести ВСЕ просроченные задачи (с прошлых дней) на сегодня разом. ' +
    'Вызывай на «перенеси все просроченные на сегодня». Выполняется только ' +
    'после явного подтверждения.',
  category: 'task',
  schema: z.object({}),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['перенеси все просроченные на сегодня', 'перетащи просрочки на сегодня'],
  handler: async (_input, ctx) => {
    const tz = await getUserTimezone(ctx.userId);
    const today = localDateOnlyUTC(tz);
    const res = await prisma.task.updateMany({
      where: { userId: ctx.userId, date: { lt: today }, completed: false, cancelled: false },
      data: { date: today },
    });
    return {
      message:
        res.count > 0
          ? `Перенесла ${res.count} просроченных задач на сегодня.`
          : 'Просроченных задач нет — переносить нечего.',
      count: res.count,
    };
  },
});
