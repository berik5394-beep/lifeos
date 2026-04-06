import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  buildAssistantPrompt,
  type AssistantContext,
} from '../ai/assistant-personality.js';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

const chatSchema = z.object({
  text: z.string().min(1, 'Текст обязателен'),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ParsedAction {
  type: string;
  data: Record<string, unknown>;
}

function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  const actionRegex = /\[ACTION:(\w+):(\{[^}]+\})\]/g;
  const actions: ParsedAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const data = JSON.parse(match[2]) as Record<string, unknown>;
      actions.push({ type: match[1], data });
    } catch {
      // Skip malformed actions
    }
  }

  const cleanText = text.replace(actionRegex, '').trim();

  return { cleanText, actions };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- AI Chat ---

  app.post('/voice/chat', {
    preHandler: validate(chatSchema),
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof chatSchema>;
    const userId = request.userId;

    try {
      // 1. Get user
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          assistantStyle: true,
          currency: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ message: 'Пользователь не найден' });
      }

      // 2. Get last 10 chat messages for conversation history
      const recentMessages = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          role: true,
          content: true,
        },
      });

      // Reverse to get chronological order
      const conversationHistory = recentMessages.reverse();

      // 3. Build full user context
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const [
        todayTasks,
        activeHabits,
        todayHabitLogs,
        upcomingEvents,
        expenseAgg,
        budgetAgg,
        yearlyGoals,
      ] = await Promise.all([
        prisma.task.findMany({
          where: { userId, date: today },
          select: { title: true, completed: true },
        }),
        prisma.habit.findMany({
          where: { userId, active: true },
          select: { id: true },
        }),
        prisma.habitLog.findMany({
          where: { userId, date: today, completed: true },
          select: { id: true },
        }),
        prisma.calendarEvent.findMany({
          where: {
            userId,
            date: { gte: today, lt: tomorrow },
          },
          select: { title: true, startTime: true, date: true },
          orderBy: { startTime: 'asc' },
        }),
        prisma.expense.aggregate({
          where: { userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
        prisma.budgetLimit.aggregate({
          where: {
            userId,
            month: today.getMonth() + 1,
            year: today.getFullYear(),
          },
          _sum: { monthlyLimit: true },
        }),
        prisma.yearlyGoal.findMany({
          where: { userId, year: today.getFullYear() },
          select: { area: true, goalText: true, progress: true },
        }),
      ]);

      const spentThisMonth = expenseAgg._sum.amount ?? 0;
      const budgetLimit = budgetAgg._sum.monthlyLimit ?? 0;

      // Calculate streak
      const currentStreak = await calculateStreak(userId);

      // Calculate week progress
      const weekProgress = await calculateWeekProgress(userId, today);

      const yearlyGoalsSummary = yearlyGoals.length > 0
        ? yearlyGoals.map((g) => `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`).join('; ')
        : 'Не заданы';

      const context: AssistantContext = {
        userName: user.name,
        assistantStyle: user.assistantStyle as 'friendly' | 'strict' | 'calm' | 'toxic',
        todayTasks: todayTasks.map((t) => ({ title: t.title, completed: t.completed })),
        habitsProgress: {
          total: activeHabits.length,
          completed: todayHabitLogs.length,
        },
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

      // 4. Build system prompt with chat-specific instructions
      const basePrompt = buildAssistantPrompt(context);
      const chatPrompt = `${basePrompt}

ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА ДЛЯ ЧАТА:
1. Ты можешь предлагать действия. Если предлагаешь действие, добавь в конец JSON: [ACTION:create_task:{"title":"...","date":"...","category":"..."}] или [ACTION:add_expense:{"amount":...,"category":"...","description":"..."}]
2. Возможные действия: create_task, complete_task, complete_habit, add_expense, add_income
3. Действия добавляй ТОЛЬКО если пользователь явно просит что-то сделать.
4. Ты ведёшь диалог — помни предыдущие сообщения.`;

      // 5. Send to Claude API
      const messages: Anthropic.MessageParam[] = [
        ...conversationHistory.map((msg): Anthropic.MessageParam => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        { role: 'user', content: text },
      ];

      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: chatPrompt,
        messages,
      });

      const responseContent = aiResponse.content[0];
      const rawResponseText = responseContent.type === 'text'
        ? responseContent.text
        : 'Не удалось сформировать ответ.';

      // 6. Parse actions from response
      const { cleanText, actions } = parseActions(rawResponseText);

      // 7. Save both messages to DB
      await prisma.chatMessage.createMany({
        data: [
          {
            userId,
            role: 'user',
            content: text,
          },
          {
            userId,
            role: 'assistant',
            content: cleanText,
            actions: actions.length > 0 ? JSON.parse(JSON.stringify(actions)) : undefined,
          },
        ],
      });

      // 8. Return response
      return reply.send({
        message: cleanText,
        ...(actions.length > 0 ? { actions } : {}),
        context: {
          tasksToday: todayTasks.length,
          tasksCompleted: todayTasks.filter((t) => t.completed).length,
          habitsTotal: activeHabits.length,
          habitsCompleted: todayHabitLogs.length,
          spentThisMonth,
          budgetLimit,
          currentStreak,
          weekProgress,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки чата',
      });
    }
  });

  // --- Chat History ---

  app.get('/chat/history', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const result = historyQuerySchema.safeParse(query);

    if (!result.success) {
      return reply.status(400).send({
        message: 'Ошибка валидации',
        errors: result.error.flatten().fieldErrors,
      });
    }

    const { limit, offset } = result.data;

    const messages = await prisma.chatMessage.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return reply.send(messages);
  });

  // --- Clear Chat History ---

  app.delete('/chat/history', async (request, reply) => {
    await prisma.chatMessage.deleteMany({
      where: { userId: request.userId },
    });

    return reply.send({ success: true, message: 'История чата очищена' });
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
      where: { userId, date: dayDate, completed: true },
    });

    const completionRate = completedLogs / activeHabits;

    if (completionRate > 0.5) {
      streak++;
    } else {
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
      date: { gte: weekStart, lt: weekEnd },
    },
    select: { completed: true },
  });

  if (weekTasks.length === 0) return 0;

  const completedCount = weekTasks.filter((t) => t.completed).length;
  return completedCount / weekTasks.length;
}
