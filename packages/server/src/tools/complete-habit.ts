import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { matchHabit, buildNotFoundMessage } from './_habit-match.js';
import { onHabitDone } from '../services/coins.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy complete_habit. */
export const completeHabitTool = defineTool({
  name: 'complete_habit',
  description:
    'Отметить ОДНУ привычку выполненной сегодня. Если в одном сообщении ' +
    'несколько привычек («бег И чтение», «все утренние») — используй ' +
    'complete_multiple_habits. Вызывай на «отметь X», «сделал X», ' +
    '«выполнил X», если X — привычка из списка привычек. Если X — разовое ' +
    'дело из задач — complete_task, не я (не нашёл привычку, но есть такая ' +
    'задача — закрою задачу сам).',
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
    // habit-day (2026-11-05): @db.Date = КАЛЕНДАРНАЯ дата юзера (как пишет
    // приложение POST /habits/:id/log и как задачи/события). Инстант локальной полуночи
    // давал реальный инстант полуночи → для UTC+ зон в @db.Date это ВЧЕРА.
    const today = localDateOnlyUTC(tz);
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
        // «Сделал X» без такой привычки, но с открытой задачей X → закрываем
        // задачу (флаг; спека перегруза, часть D: сначала привычка, иначе задача).
        const { isV2RescheduleEnabled } = await import('../lib/feature-flags.js');
        if (isV2RescheduleEnabled(userId)) {
          const { matchTaskByWholeWords } = await import('../services/task-title.js');
          const open = await prisma.task.findMany({
            where: { userId, completed: false, cancelled: false },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          // Строго: все слова фразы — целыми словами в названии, и ровно одна
          // такая задача («йогу» ≠ «Купить йогурт»; две «отчёт» → не гадаем).
          const task = matchTaskByWholeWords(input.name, open);
          if (task) {
            // Через реестр (аудит ToolCall + честная память «Выполнил задачу «…»»).
            const { runRegistryTool } = await import('./index.js');
            const out = (await runRegistryTool('complete_task', { taskId: task.id, title: task.title }, ctx)) as {
              message: string;
              taskId: string;
            };
            // completedTask — чтобы внешний захват памяти не записал «Отметил привычку».
            return { ...out, completedTask: true };
          }
        }
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
    await onHabitDone(userId, habit.id, today.toISOString().slice(0, 10), habit.name);
    let suffix = '';
    try {
      const { isV2GoalHabitsEnabled } = await import('../lib/feature-flags.js');
      if (habit.goalId && isV2GoalHabitsEnabled(userId)) {
        const [goal, streak] = await Promise.all([
          // userId — вторая линия защиты: старые привязки к чужой цели (до IDOR-фикса /habits).
          prisma.yearlyGoal.findFirst({ where: { id: habit.goalId, userId }, select: { goalText: true } }),
          import('../services/streak-service.js').then((m) => m.calculateStreak(userId)),
        ]);
        if (goal) suffix = ` — это к цели «${goal.goalText}», серия ${streak} дней`;
      }
    } catch {
      /* best-effort: связка не должна ломать отметку */
    }
    return { message: `Привычка "${habit.name}" отмечена ✅${suffix}`, habitId: habit.id };
  },
});
