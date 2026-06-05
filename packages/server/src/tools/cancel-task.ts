import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { matchOpenTask } from '../services/task-title.js';
import { defineTool } from './_types.js';

/**
 * Отменить (убрать) задачу — мягко, ОБРАТИМО (cancelled=true, не hard-delete).
 * Убирает из активных (get_tasks/брифинг её прячут), но данные сохраняются.
 * Вызывай на «убери/удали/отмени задачу X». Поиск — через matchOpenTask
 * (надёжно по «грязному» вводу).
 */
export const cancelTaskTool = defineTool({
  name: 'cancel_task',
  description:
    'Убрать/отменить задачу из активного списка. Вызывай на «убери задачу X», ' +
    '«удали задачу X», «отмени X». Обратимо — задача не удаляется насовсем.',
  category: 'task',
  aliases: { taskTitle: 'title', task: 'title', name: 'title', task_title: 'title' },
  schema: z.object({
    title: z.string().max(300).optional(),
    taskId: z.string().max(60).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['убери задачу отчёт', 'отмени задачу тренировка', 'удали задачу созвон'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    let task = input.taskId
      ? await prisma.task.findFirst({ where: { id: input.taskId, userId } })
      : null;
    if (!task && input.title) {
      const candidates = await prisma.task.findMany({
        where: { userId, completed: false, cancelled: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      task = matchOpenTask(input.title, candidates);
    }
    if (!task) return { message: 'Задача не найдена', notFound: true };
    await prisma.task.update({
      where: { id: task.id },
      data: { cancelled: true },
    });
    return { message: `Задача "${task.title}" убрана 🗑️`, taskId: task.id };
  },
});
