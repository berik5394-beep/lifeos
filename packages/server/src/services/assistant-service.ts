import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import {
  buildJarvisPrompt,
  type AssistantContext,
  type JarvisPromptOpts,
} from '../ai/jarvis-prompt.js';
import { parseIntent } from '../ai/intent-parser.js';
import { calculateStreak, calculateWeekProgress } from './streak-service.js';
import { getRelevantMemories } from './memory-service.js';

/**
 * Сбор полного контекста пользователя + intent. ОДИН сборщик —
 * используется и assistant-service (fallback), и оркестратором
 * (основной чат-путь, variant A: полный контекст всегда). Это и
 * убирает расхождение промтов: все пути берут один контекст и
 * один билдер (jarvis-prompt).
 */

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

export interface GatheredContext {
  context: AssistantContext;
  intent: { action: string; [key: string]: unknown };
  /** Для ритуала ночи. */
  dayCompletionPercent: number;
  counts: {
    tasksToday: number;
    tasksCompleted: number;
    habitsTotal: number;
    habitsCompleted: number;
    spentThisMonth: number;
    budgetLimit: number;
    currentStreak: number;
    weekProgress: number;
  };
}

export async function gatherAssistantContext(
  userId: string,
  text: string,
  /** Уже распарсенный intent (оркестратор парсит раньше) — чтобы не
   *  дёргать parseIntent дважды (лишний Claude-вызов). */
  knownIntent?: { action: string; [key: string]: unknown },
): Promise<GatheredContext | null> {
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
  if (!user) return null;

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
    currentStreak,
    weekProgress,
    yearlyGoals,
    memories,
    intent,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today },
      select: { title: true, completed: true },
    }),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true } }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { id: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: today, lt: tomorrow } },
      select: { title: true, startTime: true, date: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.aggregate({
      where: { userId, month: today.getMonth() + 1, year: today.getFullYear() },
      _sum: { monthlyLimit: true },
    }),
    calculateStreak(userId),
    calculateWeekProgress(userId, today),
    prisma.yearlyGoal.findMany({
      where: { userId, year: today.getFullYear() },
      select: { area: true, goalText: true, progress: true },
    }),
    getRelevantMemories(userId, text, 20),
    knownIntent ? Promise.resolve(knownIntent) : parseIntent(text),
  ]);

  const habitsProgress = {
    total: activeHabits.length,
    completed: todayHabitLogs.length,
  };
  const spentThisMonth = expenseAgg._sum.amount ?? 0;
  const budgetLimit = budgetAgg._sum.monthlyLimit ?? 0;
  const tasksCompleted = todayTasks.filter((t) => t.completed).length;
  const yearlyGoalsSummary =
    yearlyGoals.length > 0
      ? yearlyGoals
          .map((g) => `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`)
          .join('; ')
      : 'Не заданы';

  const context: AssistantContext = {
    userName: user.name,
    assistantStyle: user.assistantStyle as AssistantContext['assistantStyle'],
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
    memories,
  };

  const totalItems = todayTasks.length + habitsProgress.total;
  const completedItems = tasksCompleted + habitsProgress.completed;
  const dayCompletionPercent =
    totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

  return {
    context,
    intent,
    dayCompletionPercent,
    counts: {
      tasksToday: todayTasks.length,
      tasksCompleted,
      habitsTotal: habitsProgress.total,
      habitsCompleted: habitsProgress.completed,
      spentThisMonth,
      budgetLimit,
      currentStreak,
      weekProgress,
    },
  };
}

/** intent → опции ритуала для единого билдера. */
export function ritualOptsFor(
  intent: { action: string },
  dayCompletionPercent: number,
): JarvisPromptOpts {
  if (intent.action === 'goodnight') {
    return { ritual: 'night', dayCompletionPercent };
  }
  if (intent.action === 'good_morning') return { ritual: 'morning' };
  return {};
}

export interface AssistantReply {
  text: string;
  intent: { action: string; [key: string]: unknown };
  context: GatheredContext['counts'];
}

/**
 * Не-агентный ответ (fallback оркестратора, когда runAgent упал).
 * Тот же единый промт, но без web_search/инструментов — это
 * сознательно деградированный редкий путь.
 */
export async function getAssistantReply(
  userId: string,
  text: string,
): Promise<AssistantReply> {
  const gathered = await gatherAssistantContext(userId, text);
  if (!gathered) throw new Error('Пользователь не найден');

  const systemPrompt = buildJarvisPrompt(
    gathered.context,
    ritualOptsFor(gathered.intent, gathered.dayCompletionPercent),
  );

  const aiResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });

  const responseContent = aiResponse.content[0];
  const responseText =
    responseContent && responseContent.type === 'text'
      ? responseContent.text
      : 'Не удалось сформировать ответ.';

  return { text: responseText, intent: gathered.intent, context: gathered.counts };
}
