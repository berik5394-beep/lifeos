import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy complete_task. */
export const completeTaskTool = defineTool({
  name: 'complete_task',
  description: 'Отметить задачу выполненной по названию или id.',
  category: 'task',
  schema: z.object({
    title: z.string().max(300).optional(),
    taskId: z.string().max(60).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['закрой задачу отчёт', 'выполнил задачу купить хлеб'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    let task = input.taskId
      ? await prisma.task.findFirst({ where: { id: input.taskId, userId } })
      : null;
    if (!task && input.title) {
      task = await prisma.task.findFirst({
        where: {
          userId,
          title: { contains: input.title, mode: 'insensitive' },
          completed: false,
        },
      });
    }
    if (!task) return { message: 'Задача не найдена', notFound: true };
    await prisma.task.update({
      where: { id: task.id },
      data: { completed: true },
    });
    return { message: `Задача "${task.title}" выполнена ✅`, taskId: task.id };
  },
});
