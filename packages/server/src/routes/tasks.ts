import type { FastifyInstance } from 'fastify';
import { kanbanForCompletion, kanbanLabel } from '../services/kanban-signals.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseMonth, invalidDateReply } from '../middleware/validate.js';
import { NotFoundError } from '../lib/errors.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { onTaskCompleted } from '../services/coins.js';
import { proposeReschedule } from '../services/reschedule.js';
import { withIdempotency } from '../lib/idempotency.js';
import { screenConflictText } from '../services/schedule-conflict/index.js';
import { linkTaskToGoalInBackground } from '../services/task-goal-link.js';

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

  /**
   * Этап 3 (честность): «Активность за год» на «Сегодня» рисовалась по задачам
   * одной загруженной недели — остальной год пустой, как будто ничего не было.
   * Здесь — % выполнения по каждому дню года (без отменённых), из всей базы.
   */
  app.get('/tasks/activity', async (request, reply) => {
    const { year } = request.query as { year?: string };
    const y = year ? Number(year) : new Date().getUTCFullYear();
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return invalidDateReply(reply, 'year', 'YYYY');
    const where = {
      userId: request.userId,
      cancelled: false,
      date: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) },
    };
    const [all, done] = await Promise.all([
      prisma.task.groupBy({ by: ['date'], where, _count: { _all: true } }),
      prisma.task.groupBy({ by: ['date'], where: { ...where, completed: true }, _count: { _all: true } }),
    ]);
    const doneBy = new Map(done.map((r) => [r.date.toISOString().slice(0, 10), r._count._all]));
    const days: Record<string, number> = {};
    for (const r of all) {
      const key = r.date.toISOString().slice(0, 10);
      days[key] = Math.round(((doneBy.get(key) ?? 0) / r._count._all) * 100);
    }
    return { year: y, days };
  });

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
          cancelled: false,
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
          cancelled: false,
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
          cancelled: false,
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
      where: { userId: request.userId, cancelled: false },
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
    // Idempotency-Key: повтор офлайн-очереди не создаст задачу второй раз.
  }, async (request, reply) => withIdempotency(request, reply, async () => {
    const data = request.body as z.infer<typeof createTaskSchema>;
    // B.3 (IDOR): parentId раньше писался без проверки владения —
    // можно было вложить свою задачу в ЧУЖУЮ. Проверяем ownership.
    if (data.parentId) {
      const parent = await prisma.task.findFirst({
        where: { id: data.parentId, userId: request.userId },
        select: { id: true },
      });
      if (!parent) {
        return { status: 404, body: { message: 'Родительская задача не найдена' } };
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
        kanbanMovedAt: new Date(),
        // Как PATCH /kanban: записал сразу в «Готово» — задача выполнена.
        ...(data.kanbanStatus === 'done' ? { completed: true } : {}),
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
    // Задача — явный шаг к годовой цели? Фоном (флаг): цель «видит» работу по ней.
    if (!data.parentId) linkTaskToGoalInBackground(request.userId, task.id, task.title);
    // Перегруз дня (флаг): робот предлагает сдвинуть график одним касанием.
    // Предложение уже в PendingAction; мобилка показывает его облачком.
    const proposal = await proposeReschedule(request.userId, data.date, task.id, new Date(), { fromCard: true });
    // Наложение на встречу/задачу того же времени — облачком робота (раньше с
    // экрана не проверялось вовсе, только в чате).
    const conflictWarning = task.completed ? null : await screenConflictText(
      request.userId,
      task.date,
      { kind: 'task', title: task.title, start: task.time },
      { taskId: task.id },
    );
    const extra = {
      ...(proposal ? { proposal: { text: proposal.text, staged: proposal.staged } } : {}),
      ...(conflictWarning ? { conflictWarning } : {}),
    };
    return { status: 201, body: { ...task, ...extra } };
  }));

  app.put('/tasks/:id', {
    preHandler: validate(updateTaskSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateTaskSchema>;

    // Атомарно: проверяем ownership и обновляем внутри одной транзакции.
    // Postgres MVCC гарантирует что никто не удалит/изменит задачу между findFirst и update.
    // IDOR (аудит 2026-11-08): B.3 проверял parentId только в POST — через PUT
    // свою задачу можно было вложить в ЧУЖУЮ (и её заголовок увидел бы владелец).
    if (data.parentId) {
      const parent = data.parentId === id
        ? null
        : await prisma.task.findFirst({ where: { id: data.parentId, userId: request.userId }, select: { id: true } });
      if (!parent) throw new NotFoundError('Родительская задача');
    }
    let previousDate: Date | null = null;
    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return null;
      previousDate = task.date;
      return tx.task.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
          // Галочка ⇄ колонка «Готово» канбана.
          ...(data.completed !== undefined ? kanbanForCompletion(data.completed, task.kanbanStatus) : {}),
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
      });
    });
    if (!updated) throw new NotFoundError('Задача');
    // Часть 6: монеты за выполненную задачу (идемпотентно, не ломает ответ).
    if (data.completed === true && updated.completed) void onTaskCompleted(request.userId, updated.id, updated.title);
    captureActivity(request.userId, {
      type: 'task_updated',
      content: `Изменил задачу «${updated.title}»`,
    });
    // Наложение по времени при ПРАВКЕ (раньше только при создании): поменяли
    // время/день у невыполненной — проверяем новое место.
    const timeTouched = data.time !== undefined || data.date !== undefined;
    const conflictWarning =
      timeTouched && !updated.completed && !updated.cancelled
        ? await screenConflictText(request.userId, updated.date, { kind: 'task', title: updated.title, start: updated.time }, { taskId: updated.id })
        : null;
    // Перегруз дня (флаг): задачу перенесли на другой день → проверяем новый день.
    const moved = !!data.date && previousDate !== null && (previousDate as Date).toISOString().slice(0, 10) !== data.date;
    if (moved && !updated.completed && !updated.cancelled) {
      const proposal = await proposeReschedule(request.userId, data.date as string, updated.id, new Date(), { fromCard: true });
      if (proposal) {
        return reply.send({ ...updated, proposal: { text: proposal.text, staged: proposal.staged }, ...(conflictWarning ? { conflictWarning } : {}) });
      }
    }
    return reply.send(conflictWarning ? { ...updated, conflictWarning } : updated);
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
    captureActivity(request.userId, {
      type: 'task_deleted',
      content: `Убрал задачу (id ${id})`,
    });
    return reply.send({ success: true });
  });

  app.patch('/tasks/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };
    // Аудит 2026-11-09: приложение шлёт ЖЕЛАЕМОЕ состояние ({completed}). Повтор из
    // офлайн-очереди (ответ не дошёл) раньше переключал обратно и снимал галочку.
    // Без тела — старый переключатель (старые сборки).
    const body = (request.body ?? {}) as { completed?: unknown };
    const wanted = typeof body.completed === 'boolean' ? body.completed : null;

    // Атомарно: проверка владельца + отметка в одной транзакции.
    const tx = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, userId: request.userId },
      });
      if (!task) return null;
      const next = wanted ?? !task.completed;
      const include = { taskTags: { include: { tag: true } }, subtasks: true } as const;
      // Уже так — ничего не меняем (без второй монеты и записи в память).
      if (next === task.completed) {
        return { updated: await tx.task.findUniqueOrThrow({ where: { id }, include }), changed: false };
      }
      const updated = await tx.task.update({
        where: { id },
        data: { completed: next, ...kanbanForCompletion(next, task.kanbanStatus) },
        // Теги в ответе — иначе после галочки они пропадали с карточки до перезагрузки.
        include,
      });
      return { updated, changed: true };
    });
    if (!tx) throw new NotFoundError('Задача');
    const result = tx.updated;
    if (!tx.changed) return reply.send(result);
    if (result.completed) void onTaskCompleted(request.userId, result.id, result.title);
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

    // Атомарная транзакция: ownership check + kanban update.
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
          ...(status !== task.kanbanStatus ? { kanbanMovedAt: new Date() } : {}),
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
      });

      return updated;
    });
    if (!result) throw new NotFoundError('Задача');
    if (status === 'done') void onTaskCompleted(request.userId, result.id, result.title);
    captureActivity(request.userId, {
      type: 'task_kanban_moved',
      content: `Передвинул задачу «${result.title}» в колонку «${kanbanLabel(status)}»`,
    });
    return reply.send(result);
  });
}
