import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseYear, invalidDateReply } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { estimateWeeklyGoalMinutesInBackground } from '../services/estimate-goal-minutes.js';
import { maybeGoalIntake, maybeShortGoalIntake } from '../services/goal-intake-gather.js';
import { clearPendingAction } from '../services/pending-actions.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localWeekStartUTC, localMonthOnlyUTC, localDateStr } from '../lib/tz.js';
import { isMoneyGoal } from '../services/goal-pace.js';
import { moneyGoalSaved, moneyGoalPercent, habitRegularity } from '../services/goal-live-progress.js';

// B.3: enum/диапазоны (аудит 3.12). area из CLAUDE.md (goalAreas),
// year ограничен, weekStart — строгий ISO (раньше z.string() →
// new Date(garbage) = Invalid Date молча).
const GOAL_AREA = z.enum(['finance', 'spirituality', 'career', 'health', 'relationships', 'creativity']);

const createWeeklyGoalSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  goalText: z.string().min(1, 'Текст цели обязателен'),
});

const updateWeeklyGoalSchema = z.object({
  goalText: z.string().optional(),
  completed: z.boolean().optional(),
  order: z.number().optional(),
});

// Цели на месяц (аудит 2026-11-09: робот их ставил, а в приложении их не было).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const createMonthlyGoalSchema = z.object({
  month: z.string().regex(MONTH_RE, 'Месяц в формате YYYY-MM').optional(),
  goalText: z.string().trim().min(1, 'Текст цели обязателен').max(300),
});
const updateMonthlyGoalSchema = z.object({
  goalText: z.string().trim().min(1).max(300).optional(),
  completed: z.boolean().optional(),
});

/** 'YYYY-MM' → @db.Date 1-го числа (UTC-полночь), без месяца — текущий месяц юзера. */
async function monthStartOf(userId: string, month?: string): Promise<Date> {
  if (month) return new Date(`${month}-01T00:00:00Z`);
  return localMonthOnlyUTC(await getUserTimezone(userId));
}

const createYearlyGoalSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  area: GOAL_AREA,
  goalText: z.string().min(1, 'Текст цели обязателен'),
  // Измеримая цель («накопить 1 000 000») — сумма сразу при создании
  // (тап «цель накоплений» прямо в «Финансах»).
  target: z.number().positive().max(1_000_000_000).optional(),
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
          archivedAt: null,
        },
        orderBy: { order: 'asc' },
      });
    }

    return prisma.weeklyGoal.findMany({
      where: { userId: request.userId, archivedAt: null },
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

  // --- Monthly Goals ---

  app.get('/goals/monthly', async (request, reply) => {
    const { month } = request.query as { month?: string };
    if (month !== undefined && !MONTH_RE.test(month)) return invalidDateReply(reply, 'month', 'YYYY-MM');
    const monthStart = await monthStartOf(request.userId, month);
    return prisma.monthlyGoal.findMany({
      where: { userId: request.userId, monthStart },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  });

  app.post('/goals/monthly', {
    preHandler: validate(createMonthlyGoalSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createMonthlyGoalSchema>;
    const monthStart = await monthStartOf(request.userId, data.month);
    const maxOrder = await prisma.monthlyGoal.aggregate({
      where: { userId: request.userId, monthStart },
      _max: { order: true },
    });
    const goal = await prisma.monthlyGoal.create({
      data: { userId: request.userId, monthStart, goalText: data.goalText, order: (maxOrder._max.order ?? -1) + 1 },
    });
    captureActivity(request.userId, {
      type: 'monthly_goal_created',
      content: `Цель месяца «${goal.goalText}» (${monthStart.toISOString().slice(0, 7)})`,
    });
    return reply.status(201).send(goal);
  });

  app.put('/goals/monthly/:id', {
    preHandler: validate(updateMonthlyGoalSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateMonthlyGoalSchema>;
    const goal = await prisma.monthlyGoal.findFirst({ where: { id, userId: request.userId } });
    if (!goal) return reply.status(404).send({ message: 'Цель не найдена' });
    const updated = await prisma.monthlyGoal.update({ where: { id }, data });
    if (data.completed !== undefined && data.completed !== goal.completed) {
      captureActivity(request.userId, {
        type: data.completed ? 'monthly_goal_completed' : 'monthly_goal_reopened',
        content: data.completed ? `Закрыл цель месяца «${updated.goalText}»` : `Вернул в работу цель месяца «${updated.goalText}»`,
      });
    } else if (data.goalText !== undefined) {
      captureActivity(request.userId, { type: 'monthly_goal_updated', content: `Изменил цель месяца «${updated.goalText}»` });
    }
    return reply.send(updated);
  });

  app.delete('/goals/monthly/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = await prisma.monthlyGoal.findFirst({ where: { id, userId: request.userId } });
    if (!goal) return reply.status(404).send({ message: 'Цель не найдена' });
    await prisma.monthlyGoal.delete({ where: { id } });
    captureActivity(request.userId, { type: 'monthly_goal_deleted', content: `Убрал цель месяца «${goal.goalText}»` });
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

    const goals = await prisma.yearlyGoal.findMany({
      where: {
        userId: request.userId,
        year: targetYear,
      },
      include: {
        habits: {
          // userId: чужие привычки, привязанные к цели до IDOR-фикса /habits, не показываем.
          where: { active: true, userId: request.userId },
          select: { id: true, name: true, category: true, createdAt: true },
        },
      },
    });
    // Живой прогресс (тот же расчёт, что у робота): деньги — накоплено с даты цели;
    // привычки — регулярность за 30 дней (отдельно от кольца).
    const today = localDateStr(await getUserTimezone(request.userId), new Date());
    return Promise.all(
      goals.map(async (g) => {
        const money = isMoneyGoal(g.area, g.target) && g.target != null;
        const saved = money ? await moneyGoalSaved(request.userId, g.createdAt) : null;
        const habitDays = await habitRegularity(request.userId, g.habits, today);
        return {
          ...g,
          habits: g.habits.map(({ createdAt: _c, ...h }) => h),
          ...(money && saved != null ? { saved, liveProgress: moneyGoalPercent(saved, g.target as number) } : {}),
          ...(habitDays ? { habitDays } : {}),
        };
      }),
    );
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
        ...(data.target != null ? { target: data.target } : {}),
      },
    });
    captureActivity(request.userId, {
      type: 'yearly_goal_created',
      content: `Годовая цель «${goal.goalText}» (${data.area}, ${data.year})`,
    });
    return reply.status(201).send(goal);
  });

  // Разбор цели при постановке с ЭКРАНА (флаг FEATURE_V2_GOAL_INTAKE). Отдельным
  // запросом ПОСЛЕ создания: само сохранение не ждёт 2–3 с расчёта. Текст кладём
  // в чат сообщением робота — чтобы «да» (голосом/текстом) пришло мозгу с
  // контекстом предложения. Только свежая цель (≤10 мин) и без повтора в чате.
  const INTAKE_FRESH_MS = 10 * 60_000;
  async function deliverIntake(
    userId: string,
    goal: { goalText: string; createdAt: Date } | null,
    compute: () => Promise<string | null>,
  ): Promise<{ text: string | null }> {
    if (!goal || Date.now() - goal.createdAt.getTime() > INTAKE_FRESH_MS) return { text: null };
    const intake = await compute();
    if (!intake) return { text: null };
    const prefix = `Про цель «${goal.goalText}»:`;
    const text = `${prefix}\n${intake}`;
    const dup = await prisma.chatMessage.count({
      // По началу «Про цель «…»:», а не точному тексту: цифры в разборе плывут со временем.
      where: { userId, role: 'assistant', content: { startsWith: prefix }, createdAt: { gte: new Date(Date.now() - INTAKE_FRESH_MS) } },
    });
    if (dup === 0) {
      // Старое неотвеченное предложение («записать расход…?») снимаем: иначе
      // «да» на разбор цели подтвердило бы его вслепую (pending проверяется
      // раньше истории). То же правило, что «сменил тему» в оркестраторе.
      await clearPendingAction(userId).catch(() => {});
      await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: text } }).catch(() => {});
    }
    return { text };
  }

  app.post('/goals/yearly/:id/intake', async (request) => {
    const { id } = request.params as { id: string };
    const goal = await prisma.yearlyGoal.findFirst({
      where: { id, userId: request.userId },
      select: { id: true, goalText: true, createdAt: true },
    });
    return deliverIntake(request.userId, goal, () => maybeGoalIntake(request.userId, goal!.id));
  });

  app.post('/goals/weekly/:id/intake', async (request) => {
    const { id } = request.params as { id: string };
    const goal = await prisma.weeklyGoal.findFirst({
      where: { id, userId: request.userId },
      select: { goalText: true, createdAt: true, weekStart: true },
    });
    // Цель на другую неделю: «свободно до конца этой недели» и окно на эту
    // неделю были бы не о той неделе — не разбираем.
    if (goal) {
      const tz = await getUserTimezone(request.userId);
      if (goal.weekStart.getTime() !== localWeekStartUTC(tz, new Date()).getTime()) return { text: null };
    }
    return deliverIntake(request.userId, goal, () =>
      maybeShortGoalIntake(request.userId, { goalText: goal!.goalText, horizon: 'week' }),
    );
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
