import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.1 — миграция agent-only read-tool get_tasks. L99 R9 fix:
 * «сегодня»/«2026-05-27» теперь интерпретируется в локальной TZ юзера
 * (раньше server-local) — consistency с write tools (complete-habit
 * и др. сохраняют task.date через localDayStartUTC). Read и write
 * теперь смотрят на один и тот же UTC instant начала локального дня.
 */

export const getTasksTool = defineTool({
  name: 'get_tasks',
  description:
    'Список задач юзера на дату (по умолчанию сегодня). Используй ' +
    'чтобы понять загрузку дня перед планированием/ответом.',
  category: 'task',
  schema: z.object({
    // L99 R9 #5 fix: regex YYYY-MM-DD (consistency с другими date-tools).
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .optional()
      .describe('дата YYYY-MM-DD (по умолчанию сегодня)'),
    includeCompleted: z
      .boolean()
      .optional()
      .describe('включать ли уже выполненные задачи (default false)'),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что у меня сегодня по задачам', 'какие задачи на сегодня'],
  handler: async (input, ctx) => {
    // L99 R9 fix: tz-aware day boundary (consistency с write side).
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const tz = user?.timezone || 'UTC';
    // Если date указана — берём середину дня UTC чтобы гарантировать
    // что попадаем в нужный локальный день для любой tz, затем
    // запрашиваем UTC instant начала этого дня в tz юзера.
    const date = input.date
      ? localDayStartUTC(tz, new Date(input.date + 'T12:00:00Z'))
      : localDayStartUTC(tz);
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
