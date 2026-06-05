import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { matchHabit, buildNotFoundMessage } from './_habit-match.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy complete_habit. */
export const completeHabitTool = defineTool({
  name: 'complete_habit',
  description:
    'Отметить ОДНУ привычку выполненной сегодня. Если в одном сообщении ' +
    'несколько привычек («бег И чтение», «все утренние») — используй ' +
    'complete_multiple_habits. Вызывай на «отметь X», «сделал X», ' +
    '«выполнил X».',
  category: 'habit',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { habitName: 'name', habit: 'name', title: 'name', habit_name: 'name' },
  schema: z.object({
    name: z.string().max(120).optional(),
    habitId: z.string().max(60).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отметь бег', 'сделал зарядку', 'выполнил чтение'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // R9 TZ-aware: «сегодня» в локальной TZ юзера.
    const tz = await getUserTimezone(userId);
    const today = localDayStartUTC(tz);
    let habit = input.habitId
      ? await prisma.habit.findFirst({
          where: { id: input.habitId, userId },
          select: { id: true, name: true, goalId: true },
        })
      : null;
    if (!habit && input.name) {
      const active = await prisma.habit.findMany({
        where: { userId, active: true },
        select: { id: true, name: true, goalId: true },
      });
      const matched = matchHabit(input.name, active);
      if (matched) {
        habit = active.find((h) => h.id === matched.id) ?? null;
      } else {
        // ЧЕСТНОСТЬ: throw → claude-agent ставит is_error:true → модель НЕ врёт «отметил».
        throw new Error(buildNotFoundMessage(input.name, active));
      }
    }
    if (!habit) {
      throw new Error('Не указано какую привычку отметить (нет имени и id).');
    }
    await prisma.habitLog.upsert({
      where: { habitId_date: { habitId: habit.id, date: today } },
      update: { completed: true },
      create: { habitId: habit.id, userId, date: today, completed: true },
    });
    return { message: `Привычка "${habit.name}" отмечена ✅`, habitId: habit.id };
  },
});
