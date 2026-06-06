import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/**
 * Массово убрать ВСЕ просроченные задачи (date < сегодня, не выполнены,
 * не отменены) — мягко, обратимо (cancelled=true). Вызывай на «убери/удали
 * все просроченные», «расчисти просрочки». needsConfirm — операция массовая.
 */
export const clearOverdueTool = defineTool({
  name: 'clear_overdue',
  description:
    'Убрать ВСЕ просроченные задачи (с прошлых дней) разом. Обратимо — ' +
    'задачи не удаляются насовсем. Вызывай на «убери все просроченные». ' +
    'Выполняется только после явного подтверждения.',
  category: 'task',
  schema: z.object({}),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['убери все просроченные задачи', 'расчисти просрочки'],
  handler: async (_input, ctx) => {
    const tz = await getUserTimezone(ctx.userId);
    const today = localDateOnlyUTC(tz);
    const res = await prisma.task.updateMany({
      where: { userId: ctx.userId, date: { lt: today }, completed: false, cancelled: false },
      data: { cancelled: true },
    });
    return {
      message:
        res.count > 0
          ? `Убрала ${res.count} просроченных задач 🗑️ Если что — вернём.`
          : 'Просроченных задач нет — всё чисто.',
      count: res.count,
    };
  },
});
