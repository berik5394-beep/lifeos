import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseYear, invalidDateReply } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { estimateWeeklyGoalMinutesInBackground } from '../services/estimate-goal-minutes.js';

// B.3: enum/диапазоны (аудит 3.12). area из CLAUDE.md (goalAreas),
// year ограничен, weekStart — строгий ISO (раньше z.string() →
// new Date(garbage) = Invalid Date молча).
const GOAL_AREA = z.enum(['finance', 'spirituality', 'career', 'health']);

const createWeeklyGoalSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  goalText: z.string().min(1, 'Текст цели обязателен'),
});

const updateWeeklyGoalSchema = z.object({
  goalText: z.string().optional(),
  completed: z.boolean().optional(),
  order: z.number().optional(),
});

const createYearlyGoalSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  area: GOAL_AREA,
  goalText: z.string().min(1, 'Текст цели обязателен'),
});

const updateYearlyGoalSchema = z.object({
  goalText: z.string().optional(),
  area: GOAL_AREA.optional(),
  progress: z.number().min(0).max(100).optional(),
});

export async function goalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Weekly Goals ---

  app.get('/goals/weekly', async (request, reply) => {
    const { week } = request.query as { week?: string };

    if (week) {
      const weekDate = parseDate(week);
      if (!weekDate) return invalidDateReply(reply, 'week', 'YYYY-MM-DD');
      return prisma.weeklyGoal.findMany({
        where: {
          userId: request.userId,
          weekStart: weekDate,
        },
        orderBy: { order: 'asc' },
      });
    }

    return prisma.weeklyGoal.findMany({
      where: { userId: request.userId },
      orderBy: [{ weekStart: 'desc' }, { order: 'asc' }],
      take: 20,
    });
  });

  app.post('/goals/weekly', {
    preHandler: validate(createWeeklyGoalSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createWeeklyGoalSchema>;

    const maxOrder = await prisma.weeklyGoal.aggregate({
      where: {
        userId: request.userId,
        weekStart: new Date(data.weekStart),
      },
      _max: { order: true },
    });

    const goal = await prisma.weeklyGoal.create({
      data: {
        userId: request.userId,
        weekStart: new Date(data.weekStart),
        goalText: data.goalText,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
    captureActivity(request.userId, {
      type: 'weekly_goal_created',
      content: `Цель недели «${goal.goalText}» (${data.weekStart})`,
    });
    // #engine: оценка усилия/нед фоном (под флагом month-load).
    void estimateWeeklyGoalMinutesInBackground(goal.id, goal.goalText, request.userId);
    return reply.status(201).send(goal);
  });

  app.put('/goals/weekly/:id', {
    preHandler: validate(updateWeeklyGoalSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateWeeklyGoalSchema>;

    const goal = await prisma.weeklyGoal.findFirst({
      where: { id, userId: request.userId },
    });
    if (!goal) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    const updated = await prisma.weeklyGoal.update({
      where: { id },
      data,
    });
    captureActivity(request.userId, {
      type: 'weekly_goal_updated',
      content: `Изменил цель недели «${updated.goalText}»`,
    });
    return reply.send(updated);
  });

  app.delete('/goals/weekly/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const goal = await prisma.weeklyGoal.findFirst({
      where: { id, userId: request.userId },
    });
    if (!goal) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    await prisma.weeklyGoal.delete({ where: { id } });
    captureActivity(request.userId, {
      type: 'weekly_goal_deleted',
      content: `Убрал цель недели «${goal.goalText}»`,
    });
    return reply.send({ success: true });
  });

  // --- Yearly Goals ---

  app.get('/goals/yearly', async (request, reply) => {
    const { year } = request.query as { year?: string };
    let targetYear = new Date().getFullYear();
    if (year) {
      const parsed = parseYear(year);
      if (parsed === null) return invalidDateReply(reply, 'year', 'YYYY (2000-2100)');
      targetYear = parsed;
    }

    return prisma.yearlyGoal.findMany({
      where: {
        userId: request.userId,
        year: targetYear,
      },
      include: {
        habits: {
          where: { active: true },
          select: { id: true, name: true, category: true },
        },
      },
    });
  });

  app.post('/goals/yearly', {
    preHandler: validate(createYearlyGoalSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createYearlyGoalSchema>;

    const goal = await prisma.yearlyGoal.create({
      data: {
        userId: request.userId,
        year: data.year,
        area: data.area,
        goalText: data.goalText,
      },
    });
    captureActivity(request.userId, {
      type: 'yearly_goal_created',
      content: `Годовая цель «${goal.goalText}» (${data.area}, ${data.year})`,
    });
    return reply.status(201).send(goal);
  });

  app.put('/goals/yearly/:id', {
    preHandler: validate(updateYearlyGoalSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateYearlyGoalSchema>;

    const goal = await prisma.yearlyGoal.findFirst({
      where: { id, userId: request.userId },
    });
    if (!goal) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    const updated = await prisma.yearlyGoal.update({
      where: { id },
      data,
    });
    captureActivity(request.userId, {
      type: 'yearly_goal_updated',
      content: `Изменил годовую цель «${updated.goalText}»`,
    });
    return reply.send(updated);
  });

  app.delete('/goals/yearly/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const goal = await prisma.yearlyGoal.findFirst({
      where: { id, userId: request.userId },
    });
    if (!goal) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    await prisma.yearlyGoal.delete({ where: { id } });
    captureActivity(request.userId, {
      type: 'yearly_goal_deleted',
      content: `Убрал годовую цель «${goal.goalText}»`,
    });
    return reply.send({ success: true });
  });
}
