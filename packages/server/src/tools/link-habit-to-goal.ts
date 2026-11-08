import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { matchHabit, type HabitRef } from './_habit-match.js';
import { captureActivity } from '../services/tool-activity-summary.js';

/**
 * Привязать СУЩЕСТВУЮЩУЮ привычку к годовой цели (или отвязать). Раньше
 * привязка была только при заведении новой (create_habit с goal), а разбор
 * цели при постановке находил подходящую привычку — и сделать с ней было
 * нечего. Читатели goalId: детектор «привычка к цели заброшена»
 * (goal-habits), «цель стоит» (strategic-view), связка в complete_habit.
 * needsConfirm:false — обратимо (повторно / «отвяжи»), не деньги.
 */
const list = (xs: HabitRef[]) => xs.map((x) => `«${x.name}»`).join(', ');

export const linkHabitToGoalTool = defineTool({
  name: 'link_habit_to_goal',
  description:
    'Привязать УЖЕ ЕСТЬ привычку к годовой цели («привяжи бег к цели марафон», ' +
    '«засчитывай чтение в цель 24 книги») или отвязать (unlink: true). Новую ' +
    'привычку сразу с целью заводит create_habit, не я.',
  category: 'habit',
  aliases: { habitName: 'habit', name: 'habit', goalName: 'goal', goalText: 'goal', goal_text: 'goal' },
  schema: z.object({
    habit: z.string().min(1).max(120),
    goal: z.string().max(200).optional(),
    unlink: z.boolean().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['привяжи бег к цели марафон', 'отвяжи чтение от цели'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const habits = await prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true, goalId: true, goal: { select: { goalText: true } } },
    });
    const refs: HabitRef[] = habits.map((h) => ({ id: h.id, name: h.name }));
    const hit = matchHabit(input.habit, refs);
    if (!hit) {
      return {
        message: refs.length
          ? `Не нашёл привычку «${input.habit}». Сейчас у тебя: ${list(refs)}. Какую привязать?`
          : `Не нашёл привычку «${input.habit}» — привычек пока нет. Завести?`,
      };
    }
    const habit = habits.find((h) => h.id === hit.id)!;

    if (input.unlink) {
      if (!habit.goalId) return { message: `Привычка «${habit.name}» и так ни к какой цели не привязана.`, habitId: habit.id };
      await prisma.habit.updateMany({ where: { id: habit.id, userId }, data: { goalId: null } });
      captureActivity(userId, { type: 'habit_unlinked', content: `Отвязал привычку «${habit.name}» от цели «${habit.goal?.goalText ?? ''}»` });
      return { message: `Отвязал «${habit.name}» от цели «${habit.goal?.goalText ?? ''}».`, habitId: habit.id };
    }

    if (!input.goal) return { message: `К какой цели привязать «${habit.name}»?`, habitId: habit.id };
    // Годовые цели этого и следующих лет (цель на следующий год тоже настоящая).
    const goals = await prisma.yearlyGoal.findMany({
      where: { userId, year: { gte: new Date().getUTCFullYear() } },
      select: { id: true, goalText: true },
    });
    const gRefs: HabitRef[] = goals.map((g) => ({ id: g.id, name: g.goalText }));
    const goal = matchHabit(input.goal, gRefs);
    if (!goal) {
      return {
        message: gRefs.length
          ? `Не нашёл цель «${input.goal}». Твои цели: ${list(gRefs)}. К какой?`
          : `Не нашёл цель «${input.goal}» — годовых целей пока нет. Поставить?`,
        habitId: habit.id,
      };
    }
    if (habit.goalId === goal.id) {
      return { message: `«${habit.name}» уже привязана к цели «${goal.name}».`, habitId: habit.id, goalId: goal.id };
    }
    await prisma.habit.updateMany({ where: { id: habit.id, userId }, data: { goalId: goal.id } });
    const moved = habit.goalId && habit.goal ? ` (была при «${habit.goal.goalText}»)` : '';
    captureActivity(userId, {
      type: 'habit_linked',
      content: `Привязал привычку «${habit.name}» к цели «${goal.name}»`,
    });
    return {
      message: `Привязал «${habit.name}» к цели «${goal.name}»${moved} — отметки теперь идут в цель, и скажу, если забросишь.`,
      habitId: habit.id,
      goalId: goal.id,
    };
  },
});
