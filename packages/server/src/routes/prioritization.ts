import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const anthropic = new Anthropic();

interface EisenhowerTask {
  id: string;
  title: string;
  category: string;
  priority: string;
  date: string;
  urgency: number;
  importance: number;
  aiScore: number;
}

export async function prioritizationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /tasks/prioritize — AI ranks user's incomplete tasks using Eisenhower matrix
  app.post('/tasks/prioritize', async (request, reply) => {
    const tasks = await prisma.task.findMany({
      where: {
        userId: request.userId,
        completed: false,
      },
      orderBy: { date: 'asc' },
      take: 50, // Limit to avoid huge AI prompts
    });

    if (tasks.length === 0) {
      return reply.send({ message: 'Нет незавершённых задач', tasks: [] });
    }

    const taskList = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      priority: t.priority,
      date: t.date.toISOString().slice(0, 10),
      time: t.time,
    }));

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `Ты — AI-планировщик задач. Проанализируй задачи пользователя и оцени каждую по матрице Эйзенхауэра.

Текущая дата: ${today}.

Для каждой задачи определи:
- urgency (1-10): насколько срочна (учитывай дату дедлайна, приоритет)
- importance (1-10): насколько важна (учитывай категорию, приоритет)
- aiScore (0-100): общий приоритетный балл (чем выше — тем важнее сделать первой)

Верни ТОЛЬКО валидный JSON массив без markdown:
[{ "id": "...", "urgency": N, "importance": N, "aiScore": N }]

Правила:
- Задачи на сегодня/завтра с high/critical приоритетом → высокая urgency
- Рабочие/финансовые задачи обычно важнее personal
- Просроченные задачи (дата < сегодня) → максимальная urgency
- aiScore = urgency * importance / 10 * 100, скорректированный твоей экспертизой`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: JSON.stringify(taskList) }],
        system: systemPrompt,
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return reply.status(500).send({ message: 'Не удалось приоритизировать задачи' });
      }

      const scores = JSON.parse(content.text) as Array<{
        id: string;
        urgency: number;
        importance: number;
        aiScore: number;
      }>;

      // Update tasks in DB with AI scores
      const updates = scores.map((s) =>
        prisma.task.update({
          where: { id: s.id },
          data: {
            urgency: s.urgency,
            importance: s.importance,
            aiScore: s.aiScore,
          },
        }),
      );

      await prisma.$transaction(updates);

      // Return updated tasks
      const updatedTasks = await prisma.task.findMany({
        where: {
          userId: request.userId,
          completed: false,
        },
        orderBy: { aiScore: 'desc' },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
      });

      return reply.send(updatedTasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка приоритизации';
      return reply.status(500).send({ message: `Не удалось приоритизировать: ${message}` });
    }
  });

  // GET /tasks/eisenhower — return tasks grouped in 4 quadrants
  app.get('/tasks/eisenhower', async (request) => {
    const tasks = await prisma.task.findMany({
      where: {
        userId: request.userId,
        completed: false,
        urgency: { not: null },
        importance: { not: null },
      },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
      orderBy: { aiScore: 'desc' },
    });

    // Quadrants: urgency/importance threshold at 5
    const quadrants = {
      do_first: tasks.filter((t) => (t.urgency ?? 0) > 5 && (t.importance ?? 0) > 5),
      schedule: tasks.filter((t) => (t.urgency ?? 0) <= 5 && (t.importance ?? 0) > 5),
      delegate: tasks.filter((t) => (t.urgency ?? 0) > 5 && (t.importance ?? 0) <= 5),
      eliminate: tasks.filter((t) => (t.urgency ?? 0) <= 5 && (t.importance ?? 0) <= 5),
    };

    return quadrants;
  });
}
