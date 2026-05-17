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
import { getWeather } from './external-apis.js';
import {
  localDayStartUTC,
  localDayStartUTCOffset,
  localDateStr,
} from '../lib/tz.js';

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
      timezone: true,
    },
  });
  if (!user) return null;

  // B.5 модуль №1: «сегодня» по таймзоне юзера, не серверный UTC
  // (раньше после 19:00 в Алматы контекст показывал «завтра»).
  // @db.Date хранит дату как UTC-полночь → tz-окно дня её содержит,
  // выборки корректны без правки write-side.
  const tz = user.timezone || 'Asia/Almaty';
  const today = localDayStartUTC(tz);
  const tomorrow = localDayStartUTCOffset(tz, -1); // следующий лок. день
  const [ly, lm] = localDateStr(tz).split('-').map(Number);
  const monthStart = new Date(Date.UTC(ly, lm - 1, 1));
  const monthEnd = new Date(Date.UTC(ly, lm, 1));

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
    weeklyGoals,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today },
      select: { title: true, completed: true },
    }),
    // meta#9: имя нужно, чтобы сказать «не отметил ЙОГУ», а не «1 из 4»
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
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
      where: { userId, month: lm, year: ly },
      _sum: { monthlyLimit: true },
    }),
    calculateStreak(userId),
    calculateWeekProgress(userId, today),
    prisma.yearlyGoal.findMany({
      where: { userId, year: ly },
      select: { area: true, goalText: true, progress: true },
    }),
    getRelevantMemories(userId, text, 20),
    knownIntent ? Promise.resolve(knownIntent) : parseIntent(text),
    // meta#9: план на эту неделю (WeeklyGoal, weekStart = понедельник)
    (() => {
      // Понедельник недели по ЛОКАЛЬНОЙ дате юзера (weekStart @db.Date
      // = UTC-полночь понедельника). Считаем в UTC от лок. даты.
      const d = new Date(Date.UTC(ly, lm - 1, Number(localDateStr(tz).slice(8, 10))));
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return prisma.weeklyGoal.findMany({
        where: { userId, weekStart: d },
        select: { goalText: true, completed: true },
        orderBy: { order: 'asc' },
        take: 10,
      });
    })(),
  ]);

  const habitsProgress = {
    total: activeHabits.length,
    completed: todayHabitLogs.length,
  };
  // meta#9: какие именно привычки сегодня НЕ закрыты (по имени) +
  // план недели — мозг должен сам напоминать про йогу/духовное/
  // недельные цели, а не молчать «1 из 4».
  const doneHabitIds = new Set(todayHabitLogs.map((l) => l.habitId));
  const pendingHabits = activeHabits
    .filter((h) => !doneHabitIds.has(h.id))
    .map((h) => h.name)
    .slice(0, 8);
  const weeklyPlan =
    weeklyGoals.length > 0
      ? `${weeklyGoals.filter((g) => g.completed).length}/${weeklyGoals.length} — ` +
        weeklyGoals
          .map((g) => `${g.completed ? '✓' : '○'} ${g.goalText}`)
          .slice(0, 6)
          .join('; ')
      : undefined;
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
    pendingHabits,
    weeklyPlan,
    memories,
  };

  // Проактивная погода: ТОЛЬКО если сегодня есть событие — тогда
  // «одевайся легко / выезжай раньше» рождается само, без случайного
  // web_search. Best-effort: сеть не должна валить/тормозить чат
  // (Open-Meteo, без ключа; getWeather сам с таймаутом).
  if (upcomingEvents.length > 0) {
    try {
      const w = await getWeather('Алматы');
      if (w.description && !w.description.includes('ошибка')) {
        context.weatherToday = `${w.temp}°C, ${w.description}, ветер ${w.wind} км/ч`;
      }
    } catch {
      /* погода — не критично, пропускаем */
    }
  }

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
