import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

const addDependencySchema = z.object({
  prerequisiteTaskId: z.string().min(1, 'ID задачи-предшественника обязателен').max(64),
});

/**
 * B.2: детект цикла. Ребро (dependentTaskId зависит от
 * prerequisiteTaskId) = "prereq должен завершиться раньше dependent".
 * Добавление ребра newDependent→newPrereq создаёт цикл, если из
 * newPrereq уже достижим newDependent по цепочке "зависит от".
 * Чистая функция — тестируется без БД (аудит просил DFS перед create).
 */
export function wouldCreateCycle(
  edges: { dependentTaskId: string; prerequisiteTaskId: string }[],
  newDependent: string,
  newPrereq: string,
): boolean {
  if (newDependent === newPrereq) return true;
  const dependsOn = new Map<string, string[]>();
  for (const e of edges) {
    const arr = dependsOn.get(e.dependentTaskId);
    if (arr) arr.push(e.prerequisiteTaskId);
    else dependsOn.set(e.dependentTaskId, [e.prerequisiteTaskId]);
  }
  const seen = new Set<string>();
  const stack = [newPrereq];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === newDependent) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of dependsOn.get(node) ?? []) stack.push(next);
  }
  return false;
}

export async function dependencyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /tasks/:id/dependencies — add prerequisite
  app.post('/tasks/:id/dependencies', {
    preHandler: validate(addDependencySchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { prerequisiteTaskId } = request.body as z.infer<typeof addDependencySchema>;

    if (id === prerequisiteTaskId) {
      throw new ValidationError('Задача не может зависеть от самой себя');
    }

    // Verify both tasks belong to user
    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) throw new NotFoundError('Задача');

    const prereq = await prisma.task.findFirst({
      where: { id: prerequisiteTaskId, userId: request.userId },
    });
    if (!prereq) throw new NotFoundError('Задача-предшественник');

    // B.2: дубликат пары (нет unique-constraint в схеме — проверяем
    // в коде, чтобы не плодить дубли; миграцию unique-индекса не
    // делаем — на существующих дублях db push упал бы).
    const existingDup = await prisma.taskDependency.findFirst({
      where: { dependentTaskId: id, prerequisiteTaskId },
      select: { id: true },
    });
    if (existingDup) {
      throw new ValidationError('Такая зависимость уже существует');
    }

    // B.2: цикл. Грузим рёбра юзера (через relation на dependentTask)
    // и проверяем DFS перед созданием.
    const edges = await prisma.taskDependency.findMany({
      where: { dependentTask: { userId: request.userId } },
      select: { dependentTaskId: true, prerequisiteTaskId: true },
    });
    if (wouldCreateCycle(edges, id, prerequisiteTaskId)) {
      throw new ValidationError(
        'Это создаст циклическую зависимость между задачами',
      );
    }

    const dep = await prisma.taskDependency.create({
      data: {
        dependentTaskId: id,
        prerequisiteTaskId,
      },
    });
    return reply.status(201).send(dep);
  });

  // DELETE /tasks/:id/dependencies/:depId — remove dependency
  app.delete('/tasks/:id/dependencies/:depId', async (request) => {
    const { id, depId } = request.params as { id: string; depId: string };

    // Verify task ownership
    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) throw new NotFoundError('Задача');

    const dep = await prisma.taskDependency.findFirst({
      where: {
        id: depId,
        dependentTaskId: id,
      },
    });
    if (!dep) throw new NotFoundError('Зависимость');

    await prisma.taskDependency.delete({ where: { id: depId } });
    return { success: true };
  });

  // GET /tasks/:id/dependencies — list deps (both directions)
  app.get('/tasks/:id/dependencies', async (request) => {
    const { id } = request.params as { id: string };

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) throw new NotFoundError('Задача');

    const [dependsOn, dependedBy] = await Promise.all([
      prisma.taskDependency.findMany({
        where: { dependentTaskId: id },
        include: { prerequisiteTask: { select: { id: true, title: true, completed: true } } },
      }),
      prisma.taskDependency.findMany({
        where: { prerequisiteTaskId: id },
        include: { dependentTask: { select: { id: true, title: true, completed: true } } },
      }),
    ]);

    return { dependsOn, dependedBy };
  });
}
