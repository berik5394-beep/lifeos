import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseMonth, invalidDateReply } from '../middleware/validate.js';
import { NotFoundError } from '../lib/errors.js';
import { addXP } from './pet.js';
import { captureActivity } from '../services/tool-activity-summary.js';

// CLAUDE.md spec: завершил задачу = +15 XP к питомцу.
const TASK_XP_REWARD = 15;

// Максимум задач на один запрос — защита от OOM на клиенте у power users
const MAX_TASKS_PER_REQUEST = 500;

const createTaskSchema = z.object({
  title: z.string().min(1, 'Название обязательно').max(500),
  category: z.string().max(64),
  priority: z.string().max(32),
  // Жёсткая валидация YYYY-MM-DD до того как `new Date(data.date)` молча
  // создаст Invalid Date и Prisma запишет мусор.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  time: z.string().max(8).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  kanbanStatus: z.string().max(32).optional(),
  parentId: z.string().max(64).nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  recurrence: z.string().max(64).nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  completed: z.boolean().optional(),
});

const kanbanStatusSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/tasks', async (request, reply) => {
    const { date, week, month } = request.query as { date?: string; week?: string; month?: string };

    if (week) {
      const weekStart = parseDate(week);
      if (!weekStart) return invalidDateReply(reply, 'week', 'YYYY-MM-DD');
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: weekStart, lt: weekEnd },
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take: MAX_TASKS_PER_REQUEST,
      });
    }

    if (date) {
      const parsed = parseDate(date);
      if (!parsed) return invalidDateReply(reply, 'date', 'YYYY-MM-DD');
      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: parsed,
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_TASKS_PER_REQUEST,
      });
    }

    if (month) {
      const range = parseMonth(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');

      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: range.start, lt: range.end },
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take: MAX_TASKS_PER_REQUEST,
      });
    }

    return prisma.task.findMany({
      where: { userId: request.userId },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
      take: MAX_TASKS_PER_REQUEST,
    });
  });

  app.post('/tasks', {
    preHandler: validate(createTaskSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createTaskSchema>;
    // B.3 (IDOR): parentId раньше писался без проверки владения —
    // можно было вложить свою задачу в ЧУЖУЮ. Проверяем ownership.
    if (data.parentId) {
      const parent = await prisma.task.findFirst({
        where: { id: data.parentId, userId: request.userId },
        select: { id: true },
      });
      if (!parent) {
        return reply
          .status(404)
          .send({ message: 'Родительская задача не найдена' });
      }
    }
    const task = await prisma.task.create({
      data: {
        title: data.title,
        category: data.category,
        priority: data.priority,
        date: new Date(data.date),
        time: data.time ?? null,
        notes: data.notes ?? null,
        kanbanStatus: data.kanbanStatus ?? 'todo',
        parentId: data.parentId ?? null,
        estimatedMinutes: data.estimatedMinutes ?? null,
        recurrence: data.recurrence ?? null,
        userId: request.userId,
      },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
    });
    captureActivity(request.userId, {
      type: 'task_created',
      content: `Создал задачу «${task.title}» на ${data.date}`,
    });
    return reply.status(201).send(task);
  });

  app.put('/tasks/:id', {
    preHandler: validate(updateTaskSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateTaskSchema>;

    // Атомарно: проверяем ownership и обновляем внутри одной транзакции.
    // Postgres MVCC гарантирует что никто не удалит/изменит задачу между findFirst и update.
    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return null;
      return tx.task.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
      });
    });
    if (!updated) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: 'task_updated',
      content: `Изменил задачу «${updated.title}»`,
    });
    return reply.send(updated);
  });

  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Атомарный delete с проверкой ownership. updateMany-стиль через deleteMany
    // не подходит — возвращает count, но мы хотим 404 если задача не найдена.
    const deleted = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return false;
      await tx.task.delete({ where: { id } });
      return true;
    });
    if (!deleted) throw new NotFoundError('Задача');
    return reply.send({ success: true });
  });

  app.patch('/tasks/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Атомарно: toggle complete + mana reward в одной транзакции.
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return null;

      const updated = await tx.task.update({
        where: { id },
        data: { completed: !task.completed },
      });

      // Award mana + XP when completing a task (not when uncompleting).
      // CLAUDE.md спецификация: задача = +15 XP, привычка = +10 XP.
      // Раньше тут давалась только мана → pet.xp/level не рос вообще,
      // юзеры навсегда оставались на level 1 baby (баг пойман prod-тестом).
      if (!task.completed) {
        const pet = await tx.pet.findUnique({ where: { userId: request.userId } });
        if (pet) {
          const nextMana = Math.min(pet.maxMana, pet.mana + 10);
          const xpResult = addXP(pet, TASK_XP_REWARD);
          await tx.pet.update({
            where: { userId: request.userId },
            data: {
              mana: nextMana,
              xp: xpResult.xp,
              level: xpResult.level,
              xpToNext: xpResult.xpToNext,
              stage: xpResult.stage,
              roomLevel: xpResult.roomLevel,
            },
          });
        }
      }
      return updated;
    });
    if (!result) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: result.completed ? 'task_completed' : 'task_reopened',
      content: result.completed
        ? `Выполнил задачу «${result.title}»`
        : `Вернул задачу «${result.title}» в работу`,
    });
    return reply.send(result);
  });

  // PATCH /tasks/:id/kanban — update kanban status
  app.patch('/tasks/:id/kanban', {
    preHandler: validate(kanbanStatusSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as z.infer<typeof kanbanStatusSchema>;

    // Атомарная транзакция: ownership check + kanban update + mana reward.
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return null;

      const updated = await tx.task.update({
        where: { id },
        data: {
          kanbanStatus: status,
          completed: status === 'done',
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
      });

      // Award mana + XP when moving to done (same as complete). See комментарий выше.
      if (status === 'done' && !task.completed) {
        const pet = await tx.pet.findUnique({ where: { userId: request.userId } });
        if (pet) {
          const nextMana = Math.min(pet.maxMana, pet.mana + 10);
          const xpResult = addXP(pet, TASK_XP_REWARD);
          await tx.pet.update({
            where: { userId: request.userId },
            data: {
              mana: nextMana,
              xp: xpResult.xp,
              level: xpResult.level,
              xpToNext: xpResult.xpToNext,
              stage: xpResult.stage,
              roomLevel: xpResult.roomLevel,
            },
          });
        }
      }
      return updated;
    });
    if (!result) throw new NotFoundError('Задача');
    captureActivity(request.userId, {
      type: 'task_kanban_moved',
      content: `Передвинул задачу «${result.title}» → ${status}`,
    });
    return reply.send(result);
  });
}
