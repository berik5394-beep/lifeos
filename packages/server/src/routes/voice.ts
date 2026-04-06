import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { processVoiceCommand } from '../ai/voice-pipeline.js';
import { prisma } from '../lib/prisma.js';
import {
  buildAssistantPrompt,
  buildGoodnightPrompt,
  buildGoodMorningPrompt,
  type AssistantContext,
} from '../ai/assistant-personality.js';
import { parseIntent } from '../ai/intent-parser.js';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

const voiceSchema = z.object({
  text: z.string().min(1, 'Текст обязателен'),
});

interface AssistantResponseContext {
  tasksToday: number;
  tasksCompleted: number;
  habitsTotal: number;
  habitsCompleted: number;
  spentThisMonth: number;
  budgetLimit: number;
  currentStreak: number;
  weekProgress: number;
  assistantGender: string;
  wakeUpTime: string;
}

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post('/voice/process', {
    preHandler: validate(voiceSchema),
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;

    try {
      const result = await processVoiceCommand(text);
      return reply.send(result);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки голосовой команды',
      });
    }
  });

  app.post('/voice/assistant', {
    preHandler: validate(voiceSchema),
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;
    const userId = request.userId;

    try {
      // 1. Get user from DB
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          assistantStyle: true,
          assistantGender: true,
          wakeUpTime: true,
          currency: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // 2. Get today's tasks
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayTasks = await prisma.task.findMany({
        where: {
          userId,
          date: today,
        },
        select: {
          title: true,
          completed: true,
        },
      });

      // 3. Get today's habit logs + total active habits
      const activeHabits = await prisma.habit.findMany({
        where: { userId, active: true },
        select: { id: true },
      });

      const todayHabitLogs = await prisma.habitLog.findMany({
        where: {
          userId,
          date: today,
          completed: true,
        },
        select: { id: true },
      });

      const habitsProgress = {
        total: activeHabits.length,
        completed: todayHabitLogs.length,
      };

      // 4. Get upcoming events (next 24h)
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const upcomingEvents = await prisma.calendarEvent.findMany({
        where: {
          userId,
          date: {
            gte: today,
            lt: tomorrow,
          },
        },
        select: {
          title: true,
          startTime: true,
          date: true,
        },
        orderBy: { startTime: 'asc' },
      });

      // 5. Get this month's expense total + budget limits sum
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const expenseAgg = await prisma.expense.aggregate({
        where: {
          userId,
          date: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
        _sum: { amount: true },
      });

      const budgetAgg = await prisma.budgetLimit.aggregate({
        where: {
          userId,
          month: today.getMonth() + 1,
          year: today.getFullYear(),
        },
        _sum: { monthlyLimit: true },
      });

      const spentThisMonth = expenseAgg._sum.amount ?? 0;
      const budgetLimit = budgetAgg._sum.monthlyLimit ?? 0;

      // 6. Calculate current streak (consecutive days with >50% habits completed)
      const currentStreak = await calculateStreak(userId);

      // 7. Calculate week progress (tasks completed this week / total)
      const weekProgress = await calculateWeekProgress(userId, today);

      // 8. Get yearly goals summary
      const yearlyGoals = await prisma.yearlyGoal.findMany({
        where: { userId, year: today.getFullYear() },
        select: { area: true, goalText: true, progress: true },
      });

      const yearlyGoalsSummary = yearlyGoals.length > 0
        ? yearlyGoals.map((g) => `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`).join('; ')
        : 'Не заданы';

      // Build context
      const context: AssistantContext = {
        userName: user.name,
        assistantStyle: user.assistantStyle as 'friendly' | 'strict' | 'calm' | 'toxic',
        assistantGender: user.assistantGender,
        todayTasks: todayTasks.map((t) => ({ title: t.title, completed: t.completed })),
        habitsProgress,
        upcomingEvents: upcomingEvents.map((e) => ({
          title: e.title,
          startTime: e.startTime,
          date: e.date.toISOString().split('T')[0],
        })),
        spentThisMonth,
        budgetLimit,
        currentStreak,
        weekProgress,
        yearlyGoalsSummary,
      };

      // 9-11. Determine which prompt to use
      const intent = await parseIntent(text);
      let systemPrompt: string;

      if (intent.action === 'goodnight') {
        const totalItems = todayTasks.length + habitsProgress.total;
        const completedItems = todayTasks.filter((t) => t.completed).length + habitsProgress.completed;
        const dayCompletionPercent = totalItems > 0
          ? (completedItems / totalItems) * 100
          : 0;
        systemPrompt = buildGoodnightPrompt(context, dayCompletionPercent);
      } else if (intent.action === 'good_morning') {
        systemPrompt = buildGoodMorningPrompt(context);
      } else {
        systemPrompt = buildAssistantPrompt(context);
      }

      // 12. Send to Claude API
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      });

      const responseContent = aiResponse.content[0];
      const responseText = responseContent.type === 'text'
        ? responseContent.text
        : 'Не удалось сформировать ответ.';

      // 13. Return response with context
      const responseContext: AssistantResponseContext = {
        tasksToday: todayTasks.length,
        tasksCompleted: todayTasks.filter((t) => t.completed).length,
        habitsTotal: habitsProgress.total,
        habitsCompleted: habitsProgress.completed,
        spentThisMonth,
        budgetLimit,
        currentStreak,
        weekProgress,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      };

      return reply.send({
        response: responseText,
        context: responseContext,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки запроса ассистента',
      });
    }
  });
}

async function calculateStreak(userId: string): Promise<number> {
  let streak = 0;
  const checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);

  const activeHabits = await prisma.habit.count({
    where: { userId, active: true },
  });

  if (activeHabits === 0) return 0;

  for (let i = 0; i < 365; i++) {
    const dayDate = new Date(checkDate);
    dayDate.setDate(dayDate.getDate() - i);

    const completedLogs = await prisma.habitLog.count({
      where: {
        userId,
        date: dayDate,
        completed: true,
      },
    });

    const completionRate = completedLogs / activeHabits;

    if (completionRate > 0.5) {
      streak++;
    } else {
      // For the current day, if nothing is done yet, skip it
      if (i === 0 && completedLogs === 0) {
        continue;
      }
      break;
    }
  }

  return streak;
}

async function calculateWeekProgress(userId: string, today: Date): Promise<number> {
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekTasks = await prisma.task.findMany({
    where: {
      userId,
      date: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    select: { completed: true },
  });

  if (weekTasks.length === 0) return 0;

  const completedCount = weekTasks.filter((t) => t.completed).length;
  return completedCount / weekTasks.length;
}
