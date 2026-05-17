import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 5 — write-tool. Консолидирует прежний loop из
 * jarvis-orchestrator (резолв имён → complete_habit) В САМ tool.
 * Принимает имена (что даёт парсер) и/или id; считает успешные.
 */
export const completeMultipleHabitsTool = defineTool({
  name: 'complete_multiple_habits',
  description:
    'Отметить несколько привычек выполненными сегодня. Вызывай на ' +
    '«отметь бег и чтение», «закрой все утренние привычки».',
  category: 'habit',
  schema: z.object({
    habitNames: z.array(z.string().max(120)).max(30).optional(),
    habitIds: z.array(z.string().max(60)).max(30).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отметь бег и чтение', 'я сделал медитацию и зарядку'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ids: string[] = [...(input.habitIds ?? [])];
    for (const name of input.habitNames ?? []) {
      const h = await prisma.habit.findFirst({
        where: {
          userId,
          name: { contains: name, mode: 'insensitive' },
          active: true,
        },
        select: { id: true },
      });
      if (h) ids.push(h.id);
    }

    let count = 0;
    for (const habitId of ids) {
      try {
        await prisma.habitLog.upsert({
          where: { habitId_date: { habitId, date: today } },
          update: { completed: true },
          create: { habitId, userId, date: today, completed: true },
        });
        count++;
      } catch (e) {
        console.warn(
          '[complete_multiple_habits] upsert skip:',
          e instanceof Error ? e.message : e,
        );
      }
    }
    return { message: `Отмечено привычек: ${count} ✅`, count };
  },
});
