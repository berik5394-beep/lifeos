import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 5 — write-tool. Логика 1:1 с legacy action-executor
 * + R9 TZ-coherence (v1.3.2): дата задачи теперь в локальной TZ
 * юзера (read-side get-tasks уже tz-aware — было асимметрично).
 * Обратимо → needsConfirm:false.
 */
export const createTaskTool = defineTool({
  name: 'create_task',
  description:
    'Создать ОДНУ задачу пользователю. Вызывай на «создай задачу», ' +
    '«добавь задачу», «напомни сделать X». Для разбивки БОЛЬШОЙ цели ' +
    'в дерево (план под цель: год → кварталы → недели) — используй ' +
    'decompose_goal, не create_task в цикле.',
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
    // R9 TZ coherence: дата → UTC instant начала локального дня юзера.
    // Mid-day UTC trick гарантирует попадание в нужный локальный день
    // для любой tz. Symmetric с get-tasks (read tz-aware с v1.3.0).
    const tz = await getUserTimezone(ctx.userId);
    const date = localDayStartUTC(tz, new Date(input.date + 'T12:00:00Z'));
    const task = await prisma.task.create({
      data: {
        userId: ctx.userId,
        title: input.title,
        date,
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
