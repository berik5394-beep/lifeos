import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 5 — write-tool. Логика 1:1 с legacy action-executor
 * (паритет поведения; TZ-вопрос даты задачи — отдельно, не Шаг 5).
 * Обратимо → needsConfirm:false.
 */
export const createTaskTool = defineTool({
  name: 'create_task',
  description:
    'Создать задачу пользователю. Вызывай на «создай задачу», ' +
    '«добавь задачу», «напомни сделать X».',
  category: 'task',
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    category: z.string().max(40).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['создай задачу купить хлеб завтра', 'добавь задачу отчёт'],
  handler: async (input, ctx) => {
    const task = await prisma.task.create({
      data: {
        userId: ctx.userId,
        title: input.title,
        date: new Date(input.date),
        time: input.time ?? null,
        category: input.category || 'personal',
        priority: input.priority || 'medium',
      },
    });
    return {
      message: `Задача "${input.title}" создана на ${input.date}${
        input.time ? ' в ' + input.time : ''
      }`,
      taskId: task.id,
    };
  },
});
