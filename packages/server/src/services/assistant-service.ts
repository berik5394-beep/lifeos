import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import {
  isV2SavingsCoachEnabled,
  isV2RealtimeEnabled,
} from '../lib/feature-flags.js';
import { getUserTimezone } from '../lib/user-context.js';
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
  localDateOnlyUTC,
  localDateStr,
  localWeekStartUTC,
} from '../lib/tz.js';

/**
 * Сбор полного контекста пользователя + intent. ОДИН сборщик —
 * используется и assistant-service (fallback), и оркестратором
 * (основной чат-путь, variant A: полный контекст всегда). Это и
 * убирает расхождение промтов: все пути берут один контекст и
 * один билдер (jarvis-prompt).
 */

const anthropic = createAnthropic();

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
      // Phase 6 C5 — opt-out preference юзера; orchestrator AND-gates
      // computed therapeuticMode (опт-аут → всегда false независимо
      // от эмо-классификатора).
      therapeuticMode: true,
    },
  });
  if (!user) return null;

  // FIX 2026-06-06 (review-catch d67417d): @db.Date «сегодня» — ДВЕ конвенции.
  // task/event теперь пишутся convA (UTC-полночь календарной даты) → читаем их
  // через localDateOnlyUTC. habitLog ещё на старой convB (complete-habit не
  // мигрирован) → его читаем через localDayStartUTC (write↔read совпадают).
  const tz = user.timezone || 'Asia/Almaty';
  const today = localDayStartUTC(tz); // convB — ТОЛЬКО для habitLog
  const todayDateOnly = localDateOnlyUTC(tz); // convA — для task/event
  const tomorrowDateOnly = new Date(todayDateOnly.getTime() + 24 * 60 * 60 * 1000);
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
      where: { userId, date: todayDateOnly, cancelled: false },
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
      where: { userId, date: { gte: todayDateOnly, lt: tomorrowDateOnly } },
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
    calculateWeekProgress(userId, todayDateOnly),
    prisma.yearlyGoal.findMany({
      where: { userId, year: ly },
      select: {
        id: true,
        area: true,
        goalText: true,
        progress: true,
        target: true,
        targetDate: true,
      },
    }),
    getRelevantMemories(userId, text, 20),
    knownIntent ? Promise.resolve(knownIntent) : parseIntent(text),
    // meta#9: план на эту неделю (WeeklyGoal, weekStart = понедельник)
    (() => {
      // Понедельник недели юзера (weekStart @db.Date). SSOT-хелпер —
      // та же точка, что и create_weekly_goal (write↔read совпадают).
      const d = localWeekStartUTC(tz);
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
  // За флагом коуча: к сводке целей добавляем сумму/срок/id, чтобы бот мог
  // сослаться на goalId при ПРАВКЕ («передвинь срок», «цель теперь 150к»)
  // → надёжный update вместо текст-матча. Off → строка байт-в-байт.
  const goalCaptureCtx = isV2SavingsCoachEnabled(userId);
  const yearlyGoalsSummary =
    yearlyGoals.length > 0
      ? yearlyGoals
          .map((g) => {
            if (!goalCaptureCtx) {
              return `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`;
            }
            const num =
              g.target != null
                ? `, ${Math.round(g.target)}${g.area === 'finance' ? '₸' : ''}`
                : '';
            const due = g.targetDate
              ? `, к ${g.targetDate.toISOString().slice(0, 10)}`
              : '';
            return `${g.area}: ${g.goalText} (${Math.round(
              g.progress,
            )}%${num}${due}) [id:${g.id}]`;
          })
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
    therapeuticMode: user.therapeuticMode,
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
  /** Phase 6 C3 — therapeutic-mode для эмо-хода (передаётся из
   *  orchestrator-fallback, где emotional уже классифицирован). */
  therapeuticMode = false,
): Promise<AssistantReply> {
  const gathered = await gatherAssistantContext(userId, text);
  if (!gathered) throw new Error('Пользователь не найден');

  // Real-Time Foundation: пояс юзера в промпт ТОЛЬКО при флаге (off→undefined→
  // байт-идентично). getUserTimezone сам падает в 'UTC' при сбое.
  const nowTz = isV2RealtimeEnabled(userId)
    ? await getUserTimezone(userId)
    : undefined;
  const systemPrompt = buildJarvisPrompt(gathered.context, {
    ...ritualOptsFor(gathered.intent, gathered.dayCompletionPercent),
    therapeuticMode,
    goalCapture: isV2SavingsCoachEnabled(userId),
    nowTz,
  });

  const aiResponse = await anthropic.messages.create({
    model: MODELS.sonnet,
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
