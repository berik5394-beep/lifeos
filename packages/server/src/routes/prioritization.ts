import type { FastifyInstance } from 'fastify';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { AiModelError } from '../lib/errors.js';

// Same fix as quick-add.ts: проект использует ENV `CLAUDE_API_KEY`, а не
// дефолтный `ANTHROPIC_API_KEY` — без явного apiKey клиент 500-ит.
const anthropic = createAnthropic();

// POST /tasks/prioritize зовёт Claude Sonnet 4 с полным списком задач
// (до 50 штук) — это дорогой вызов (~$0.01-0.05 за раз). Без лимита клиент
// с багом «повторный POST при ошибке» может сжечь $50-100 за час.
const prioritizeLimiter = rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'ai:prioritize' });

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
  app.post('/tasks/prioritize', { preHandler: [prioritizeLimiter, aiDailyLimiter] }, async (request, reply) => {
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

    // Нет try/catch вокруг всего: Anthropic SDK ошибки ловит глобальный
    // registerErrorHandler и нормализует в AiModelError автоматически.
    const response = await anthropic.messages.create({
      model: MODELS.sonnet,
      max_tokens: 2000,
      messages: [{ role: 'user', content: JSON.stringify(taskList) }],
      system: systemPrompt,
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new AiModelError(new Error('Empty or non-text response from Claude'));
    }

    // Парсинг JSON отдельно — кривой ответ модели не должен приводить к 500
    // с голой строкой, а должен лететь через наш error handler как AiModelError.
    let scores: Array<{ id: string; urgency: number; importance: number; aiScore: number }>;
    try {
      scores = JSON.parse(content.text);
      if (!Array.isArray(scores)) throw new Error('expected array');
    } catch (parseErr) {
      throw new AiModelError(parseErr);
    }

    // Update tasks in DB with AI scores — транзакция гарантирует консистентность
    // (либо все задачи обновлены, либо ни одна).
    // IDOR defense: updateMany c фильтром userId гарантирует, что даже если Claude
    // галлюцинирует foreign id, мы не затронем чужие задачи (обновит 0 строк).
    const updates = scores.map((s) =>
      prisma.task.updateMany({
        where: { id: s.id, userId: request.userId },
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
