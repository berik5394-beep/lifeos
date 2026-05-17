import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy complete_habit. */
export const completeHabitTool = defineTool({
  name: 'complete_habit',
  description: 'Отметить привычку выполненной сегодня по имени или id.',
  category: 'habit',
  schema: z.object({
    name: z.string().max(120).optional(),
    habitId: z.string().max(60).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отметь бег', 'сделал зарядку', 'выполнил чтение'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let habit = input.habitId
      ? await prisma.habit.findFirst({
          where: { id: input.habitId, userId },
        })
      : null;
    if (!habit && input.name) {
      habit = await prisma.habit.findFirst({
        where: {
          userId,
          name: { contains: input.name, mode: 'insensitive' },
          active: true,
        },
      });
    }
    if (!habit) return { message: 'Привычка не найдена', notFound: true };
    await prisma.habitLog.upsert({
      where: { habitId_date: { habitId: habit.id, date: today } },
      update: { completed: true },
      create: { habitId: habit.id, userId, date: today, completed: true },
    });
    return { message: `Привычка "${habit.name}" отмечена ✅`, habitId: habit.id };
  },
});
