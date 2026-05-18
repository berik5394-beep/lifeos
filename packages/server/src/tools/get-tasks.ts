import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.1 — миграция agent-only read-tool get_tasks из
 * agent-tools.ts LOCAL_TOOLS в единый реестр. Логика 1:1 с прежним
 * runLocalTool('get_tasks') (паритет; TZ-вопрос «сегодня» — общий,
 * не правим здесь). claude-agent ещё НЕ переключён (9A.8) — агент
 * пока ходит в LOCAL_TOOLS, но диспетчер делегирует сюда + аудит.
 */

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const getTasksTool = defineTool({
  name: 'get_tasks',
  description:
    'Список задач юзера на дату (по умолчанию сегодня). Используй ' +
    'чтобы понять загрузку дня перед планированием/ответом.',
  category: 'task',
  schema: z.object({
    date: z.string().max(20).optional(),
    includeCompleted: z.boolean().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что у меня сегодня по задачам', 'какие задачи на сегодня'],
  handler: async (input, ctx) => {
    const date = input.date
      ? new Date(String(input.date) + 'T00:00:00Z')
      : startOfDay(new Date());
    const tasks = await prisma.task.findMany({
      where: {
        userId: ctx.userId,
        date,
        ...(input.includeCompleted ? {} : { completed: false }),
      },
      select: { title: true, time: true, priority: true, completed: true },
      orderBy: { time: 'asc' },
      take: 50,
    });
    return tasks;
  },
});
