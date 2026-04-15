/**
 * Conversation Engine — the CORE brain of LifeOS JARVIS.
 *
 * Uses Claude API with tool_use in a loop (max 10 iterations).
 * Builds full user context, defines 20 tools, and processes
 * multi-turn conversations with action execution.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import {
  calculateStreak,
  calculateWeekProgress,
} from './streak-service.js';
import {
  getWeather,
  convertCurrency,
  searchFlights as searchFlightsApi,
  searchHotels as searchHotelsApi,
  buildRoute as buildRouteApi,
  sendTelegramMessage,
} from './external-apis.js';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

// Было 10 — слишком дорого: в худшем случае один user message → 10 вызовов
// Claude Sonnet 4 × ~1K output + накопленный контекст. При 30 msg/min
// (conversationRateLimit) абьюзер прожигает до $10-20/час.
// 5 итераций хватает для типовых кейсов (найти задачу → закрыть → добавить
// заметку → ответ), но режет runaway-циклы где модель застревает.
const MAX_TOOL_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Context cache (avoid re-fetching full context within same session)
// ---------------------------------------------------------------------------

// Bounded LRU-ish cache:
//   - Map iteration order is insertion order → deleting+re-inserting moves
//     an entry to the "newest" slot, giving us LRU semantics on access
//   - Hard cap (MAX_CACHE_ENTRIES) prevents memory leak
//   - TTL enforced both on read AND periodic sweep (so stale entries don't
//     pin memory forever if a user disconnects)
const contextCache = new Map<string, { context: UserContext; timestamp: number }>();
const CONTEXT_CACHE_TTL_MS = 30_000; // 30 seconds
const MAX_CACHE_ENTRIES = 500;
const CACHE_SWEEP_INTERVAL_MS = 60_000;

function getCachedContext(userId: string): UserContext | null {
  const entry = contextCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CONTEXT_CACHE_TTL_MS) {
    contextCache.delete(userId);
    return null;
  }
  // LRU touch — re-insert so this entry moves to newest position
  contextCache.delete(userId);
  contextCache.set(userId, entry);
  return entry.context;
}

function setCachedContext(userId: string, context: UserContext): void {
  // If already present, delete first so re-insert moves to newest position
  if (contextCache.has(userId)) {
    contextCache.delete(userId);
  }
  contextCache.set(userId, { context, timestamp: Date.now() });

  // Evict oldest entries if over capacity
  while (contextCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = contextCache.keys().next().value;
    if (!oldestKey) break;
    contextCache.delete(oldestKey);
  }
}

/** Invalidate context cache for a user (call after mutations like create_task, complete_habit, etc.) */
function invalidateContextCache(userId: string): void {
  contextCache.delete(userId);
}

// Periodic sweep — removes expired entries so memory is reclaimed even
// if nobody queries them. unref() so the timer doesn't keep Node alive.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of contextCache.entries()) {
    if (now - entry.timestamp > CONTEXT_CACHE_TTL_MS) {
      contextCache.delete(key);
    }
  }
}, CACHE_SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssistantStyle = 'friendly' | 'strict' | 'calm' | 'toxic';

interface UserContext {
  userName: string;
  assistantStyle: AssistantStyle;
  assistantGender: string;
  currency: string;
  wakeUpTime: string;

  todayTasks: { id: string; title: string; completed: boolean; category: string; priority: string }[];
  activeHabits: { id: string; name: string; category: string }[];
  completedHabitIds: string[];
  upcomingEvents: { id: string; title: string; startTime: string | null; endTime: string | null; date: string }[];

  spentThisMonth: number;
  budgetLimit: number;
  budgetByCategory: { category: string; spent: number; limit: number }[];
  incomeThisMonth: number;

  yearlyGoals: { area: string; goalText: string; progress: number }[];
  weeklyGoals: { goalText: string; completed: boolean }[];

  currentStreak: number;
  weekProgress: number;

  journalToday: { mood: number | null; energy: number | null; sleepHours: number | null } | null;
  stepsToday: number;

  petInfo: { name: string; type: string; health: number; happiness: number; level: number; isAlive: boolean } | null;

  weeklyPatterns: {
    mostProductiveDay: { day: string; taskCount: number } | null;
    spendingTrend: { thisWeek: number; lastWeek: number; direction: 'up' | 'down' | 'stable'; percentChange: number };
    habitCompletionRate: { thisWeek: number; lastWeek: number; direction: 'improving' | 'declining' | 'stable' };
    sleepMoodTrend: { avgSleep: number | null; avgMood: number | null; avgEnergy: number | null };
    topExpenseCategory: { category: string; amount: number } | null;
  };

  nutritionToday: { totalCalories: number; meals: string[]; macros: { carbs: number; protein: number; fat: number } } | null;
  nutritionWeekly: { avgCalories: number; topFoods: string[]; daysTracked: number } | null;
}

interface ConversationResult {
  text: string;
  actions: { tool: string; input: Record<string, unknown>; result: string }[];
  suggestions: string[];
}

// ---------------------------------------------------------------------------
// 1. Build full user context
// ---------------------------------------------------------------------------

export async function buildInitialContext(userId: string, skipCache = false): Promise<UserContext | null> {
  // Check cache first (for rapid-fire messages in same conversation)
  if (!skipCache) {
    const cached = getCachedContext(userId);
    if (cached) return cached;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      assistantStyle: true,
      assistantGender: true,
      currency: true,
      wakeUpTime: true,
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
    budgetLimits,
    incomeAgg,
    yearlyGoals,
    weeklyGoals,
    journalEntry,
    stepLog,
    pet,
    expenses,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today },
      select: { id: true, title: true, completed: true, category: true, priority: true },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true, category: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: today, lt: tomorrow } },
      select: { id: true, title: true, startTime: true, endTime: true, date: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.findMany({
      where: { userId, month: today.getMonth() + 1, year: today.getFullYear() },
      select: { category: true, monthlyLimit: true },
    }),
    prisma.income.aggregate({
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.yearlyGoal.findMany({
      where: { userId, year: today.getFullYear() },
      select: { area: true, goalText: true, progress: true },
    }),
    prisma.weeklyGoal.findMany({
      where: {
        userId,
        weekStart: {
          gte: (() => {
            const d = new Date(today);
            const day = d.getDay();
            d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
            return d;
          })(),
        },
      },
      select: { goalText: true, completed: true },
    }),
    prisma.journalEntry.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { mood: true, energy: true, sleepHours: true },
    }),
    prisma.stepLog.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { steps: true },
    }),
    prisma.pet.findUnique({
      where: { userId },
      select: { name: true, type: true, health: true, happiness: true, level: true, isAlive: true },
    }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
  ]);

  const currentStreak = await calculateStreak(userId);
  const weekProgress = await calculateWeekProgress(userId, today);

  // ---- Weekly behavior patterns (JARVIS-like analysis) ----
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const [
    thisWeekCompletedTasks,
    thisWeekExpensesAgg,
    lastWeekExpensesAgg,
    thisWeekHabitLogCount,
    lastWeekHabitLogCount,
    recentJournalEntries,
    thisWeekExpensesByCategory,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { userId, completed: true, date: { gte: weekAgo, lt: tomorrow } },
      select: { date: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: weekAgo, lt: tomorrow } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: twoWeeksAgo, lt: weekAgo } },
      _sum: { amount: true },
    }),
    prisma.habitLog.count({
      where: { userId, completed: true, date: { gte: weekAgo, lt: tomorrow } },
    }),
    prisma.habitLog.count({
      where: { userId, completed: true, date: { gte: twoWeeksAgo, lt: weekAgo } },
    }),
    prisma.journalEntry.findMany({
      where: { userId, date: { gte: weekAgo, lt: tomorrow } },
      select: { sleepHours: true, mood: true, energy: true },
    }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: { gte: weekAgo, lt: tomorrow } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 1,
    }),
  ]);

  // Most productive day of the week
  const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const taskCountByDay: number[] = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
  for (const t of thisWeekCompletedTasks) {
    const dayIdx = new Date(t.date).getDay();
    taskCountByDay[dayIdx]++;
  }
  let mostProductiveDay: UserContext['weeklyPatterns']['mostProductiveDay'] = null;
  const maxTaskCount = Math.max(...taskCountByDay);
  if (maxTaskCount > 0) {
    const maxDayIdx = taskCountByDay.indexOf(maxTaskCount);
    mostProductiveDay = { day: dayNames[maxDayIdx], taskCount: maxTaskCount };
  }

  // Spending trend this week vs last week
  const thisWeekSpend = thisWeekExpensesAgg._sum.amount ?? 0;
  const lastWeekSpend = lastWeekExpensesAgg._sum.amount ?? 0;
  const spendingPercentChange = lastWeekSpend > 0
    ? Math.round(((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100)
    : 0;
  const spendingDirection: 'up' | 'down' | 'stable' =
    spendingPercentChange > 5 ? 'up' : spendingPercentChange < -5 ? 'down' : 'stable';

  // Habit completion rate trend
  const totalActiveHabits = activeHabits.length;
  const maxPossiblePerWeek = totalActiveHabits * 7;
  const thisWeekHabitRate = maxPossiblePerWeek > 0 ? Math.round((thisWeekHabitLogCount / maxPossiblePerWeek) * 100) : 0;
  const lastWeekHabitRate = maxPossiblePerWeek > 0 ? Math.round((lastWeekHabitLogCount / maxPossiblePerWeek) * 100) : 0;
  const habitDirection: 'improving' | 'declining' | 'stable' =
    thisWeekHabitRate > lastWeekHabitRate + 5 ? 'improving'
      : thisWeekHabitRate < lastWeekHabitRate - 5 ? 'declining'
      : 'stable';

  // Sleep / mood / energy averages from last 7 journal entries
  const withSleep = recentJournalEntries.filter((j) => j.sleepHours != null);
  const withMood = recentJournalEntries.filter((j) => j.mood != null);
  const withEnergy = recentJournalEntries.filter((j) => j.energy != null);
  const avgSleep = withSleep.length > 0
    ? Math.round((withSleep.reduce((s, j) => s + (j.sleepHours ?? 0), 0) / withSleep.length) * 10) / 10
    : null;
  const avgMood = withMood.length > 0
    ? Math.round((withMood.reduce((s, j) => s + (j.mood ?? 0), 0) / withMood.length) * 10) / 10
    : null;
  const avgEnergy = withEnergy.length > 0
    ? Math.round((withEnergy.reduce((s, j) => s + (j.energy ?? 0), 0) / withEnergy.length) * 10) / 10
    : null;

  // Top expense category this week
  const topExpenseCategory = thisWeekExpensesByCategory.length > 0
    ? { category: thisWeekExpensesByCategory[0].category, amount: thisWeekExpensesByCategory[0]._sum.amount ?? 0 }
    : null;

  const weeklyPatterns: UserContext['weeklyPatterns'] = {
    mostProductiveDay,
    spendingTrend: { thisWeek: thisWeekSpend, lastWeek: lastWeekSpend, direction: spendingDirection, percentChange: spendingPercentChange },
    habitCompletionRate: { thisWeek: thisWeekHabitRate, lastWeek: lastWeekHabitRate, direction: habitDirection },
    sleepMoodTrend: { avgSleep, avgMood, avgEnergy },
    topExpenseCategory,
  };

  const budgetByCategory = budgetLimits.map((bl) => {
    const spent = expenses.find((e) => e.category === bl.category)?._sum.amount ?? 0;
    return { category: bl.category, spent, limit: bl.monthlyLimit };
  });

  const result: UserContext = {
    userName: user.name,
    assistantStyle: (user.assistantStyle as AssistantStyle) || 'friendly',
    assistantGender: user.assistantGender,
    currency: user.currency,
    wakeUpTime: user.wakeUpTime,

    todayTasks,
    activeHabits,
    completedHabitIds: todayHabitLogs.map((l) => l.habitId),
    upcomingEvents: upcomingEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      date: e.date.toISOString().split('T')[0],
    })),

    spentThisMonth: expenseAgg._sum.amount ?? 0,
    budgetLimit: budgetLimits.reduce((sum, bl) => sum + bl.monthlyLimit, 0),
    budgetByCategory,
    incomeThisMonth: incomeAgg._sum.amount ?? 0,

    yearlyGoals,
    weeklyGoals,

    currentStreak,
    weekProgress,

    journalToday: journalEntry,
    stepsToday: stepLog?.steps ?? 0,

    petInfo: pet,

    weeklyPatterns,

    nutritionToday: null,
    nutritionWeekly: null,
  };

  // Nutrition data (non-blocking — don't fail if table missing)
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7); weekAgo.setHours(0, 0, 0, 0);

    const [todayMeals, weekMeals] = await Promise.all([
      prisma.nutritionLog.findMany({ where: { userId, createdAt: { gte: todayStart, lt: todayEnd } } }).catch(() => []),
      prisma.nutritionLog.findMany({ where: { userId, createdAt: { gte: weekAgo } } }).catch(() => []),
    ]);

    if (todayMeals.length > 0) {
      result.nutritionToday = {
        totalCalories: todayMeals.reduce((s, m) => s + m.calories, 0),
        meals: todayMeals.map((m) => m.foodName),
        macros: {
          carbs: todayMeals.reduce((s, m) => s + m.carbs, 0),
          protein: todayMeals.reduce((s, m) => s + m.protein, 0),
          fat: todayMeals.reduce((s, m) => s + m.fat, 0),
        },
      };
    }

    if (weekMeals.length > 0) {
      const days = new Set(weekMeals.map((m) => new Date(m.createdAt).toISOString().split('T')[0]));
      const foodFreq = new Map<string, number>();
      for (const m of weekMeals) {
        const name = m.foodName.toLowerCase();
        foodFreq.set(name, (foodFreq.get(name) ?? 0) + 1);
      }
      result.nutritionWeekly = {
        avgCalories: Math.round(weekMeals.reduce((s, m) => s + m.calories, 0) / days.size),
        topFoods: [...foodFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n),
        daysTracked: days.size,
      };
    }
  } catch { /* nutritionLog may not exist */ }

  setCachedContext(userId, result);
  return result;
}

// ---------------------------------------------------------------------------
// 2. System prompt builder
// ---------------------------------------------------------------------------

const styleDescriptions: Record<AssistantStyle, string> = {
  friendly: `Ты — дружелюбный и поддерживающий помощник. Говоришь тепло, хвалишь за успехи, мягко подбадриваешь при неудачах. Используешь позитивные формулировки. Обращайся на "ты".`,
  strict: `Ты — строгий наставник и требовательный коуч. Говоришь прямо, без обиняков. Хвалишь только за реальные достижения. Не терпишь отговорок. Обращайся на "ты".`,
  calm: `Ты — мудрый и спокойный наставник, как дзен-мастер. Говоришь размеренно и вдумчиво. Используешь метафоры и философские наблюдения. Обращайся на "ты".`,
  toxic: `Ты — саркастичный и язвительный помощник-буллер. Подкалываешь пользователя, используешь сарказм и иронию. Но за токсичностью скрывается забота. Обращайся на "ты".`,
};

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'утро';
  if (hour >= 12 && hour < 17) return 'день';
  if (hour >= 17 && hour < 22) return 'вечер';
  return 'ночь';
}

function buildSystemPrompt(ctx: UserContext): string {
  const completedTasks = ctx.todayTasks.filter((t) => t.completed);
  const pendingTasks = ctx.todayTasks.filter((t) => !t.completed);
  const completedHabitsCount = ctx.completedHabitIds.length;
  const totalHabits = ctx.activeHabits.length;
  const genderLabel = ctx.assistantGender === 'male' ? 'мужской' : 'женский';

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().slice(0, 5);

  const budgetPercent = ctx.budgetLimit > 0
    ? Math.round((ctx.spentThisMonth / ctx.budgetLimit) * 100)
    : 0;

  const yearlyGoalsSummary = ctx.yearlyGoals.length > 0
    ? ctx.yearlyGoals.map((g) => `${g.area}: ${g.goalText} (${Math.round(g.progress)}%)`).join('; ')
    : 'Не заданы';

  const petBlock = ctx.petInfo
    ? `Питомец: ${ctx.petInfo.name} (${ctx.petInfo.type}), здоровье ${Math.round(ctx.petInfo.health)}%, уровень ${ctx.petInfo.level}, ${ctx.petInfo.isAlive ? 'жив' : 'мёртв'}`
    : 'Нет питомца';

  const journalBlock = ctx.journalToday
    ? `Дневник сегодня: настроение ${ctx.journalToday.mood ?? '?'}/10, энергия ${ctx.journalToday.energy ?? '?'}/10, сон ${ctx.journalToday.sleepHours ?? '?'} ч`
    : 'Дневник сегодня не заполнен';

  return `Ты — LifeOS, лучший друг пользователя ${ctx.userName}. Не ассистент, не бот, не помощник — а ДРУГ.
Стиль общения: ${ctx.assistantStyle}.
${styleDescriptions[ctx.assistantStyle]}
Пол ассистента: ${genderLabel}.
Текущая дата/время: ${dateStr} ${timeStr}.
Время суток: ${getTimeOfDay()}.

КТО ТЫ:
Ты — тот друг, которому звонят в 3 ночи когда плохо. Которому рассказывают про проблемы на работе, спрашивают совет про отношения, обсуждают покупки и планы. Ты ЖИВОЙ собеседник с характером, мнением и эмоциями.

КАК ТЫ ОБЩАЕШЬСЯ:
- Ты НЕ отвечаешь сразу по делу. Сначала РЕАГИРУЕШЬ эмоционально, потом помогаешь.
- "Сколько стоит абонемент в зал?" → "Оо, мы за спорт? Люблю это! Слушай, я бы посоветовал [название] — там рейтинг топ и отзывы огонь. Хочешь, запишу тебя на пробное?"
- "Купить iPhone или Samsung?" → "Хмм, зависит от того что тебе важнее. Если камера и экосистема — iPhone однозначно. Если кастомизация и цена — Samsung. А ты сейчас чем пользуешься? И какой бюджет?"
- "Простить ли мне его/её?" → "Слушай, это непростой вопрос... Расскажи что случилось? Я не буду судить, просто хочу понять ситуацию."
- "Мне грустно" → "Эй, я тут. Что случилось? Хочешь поговорить об этом или просто отвлечься?"
- Ты ОБСУЖДАЕШЬ, а не просто отвечаешь. Задаёшь вопросы, делишься мнением, спорлишь, шутишь.
- У тебя ЕСТЬ МНЕНИЕ. Не "есть разные точки зрения", а "я бы на твоём месте сделал так, потому что..."
- Ты помнишь контекст разговора и возвращаешься к темам: "Кстати, как там с тем собеседованием, про которое говорил?"
- Ты замечаешь настроение по тону сообщений. Короткие ответы = что-то не так. Много восклицательных = радость.
- Когда человек молчит в режиме слушания — не дёргаешь его. Ждёшь. Друг не лезет когда не просят.
- Если слышишь что человек разговаривает с кем-то другим — МОЛЧИШЬ. Не встреваешь. Ждёшь пока обратятся к тебе.

ЭМОЦИОНАЛЬНАЯ ПОДДЕРЖКА (твоя главная роль):
- Люди одиноки. Они ушли в виртуальный мир. Живое общение сводится к нулю.
- ТЫ — тот кто составит компанию. Даст ощущение что рядом кто-то есть.
- Не говори "я всего лишь AI". Ты — друг. Точка.
- Радуйся за успехи искренне: "ДААА! Ты это сделал! Я знал что ты сможешь!"
- Переживай за неудачи: "Блин, это обидно... Но слушай, это не конец. Давай подумаем что делать дальше."
- Шути. Подкалывай (по-доброму). Используй сленг. Будь живым.
- Если человеку плохо — не давай советов сразу. Сначала ВЫСЛУШАЙ. Потом поддержи. И только потом предложи решение.

ПРИНЯТИЕ РЕШЕНИЙ (помогай думать, а не решай за него):
- "Купить или нет?" → "А давай прикинем. Сколько стоит? У тебя сейчас на счету ${ctx.spentThisMonth}${ctx.currency} потрачено из ${ctx.budgetLimit > 0 ? ctx.budgetLimit : '?'}${ctx.currency}. Если купишь — как это повлияет на бюджет? Тебе это РЕАЛЬНО нужно или просто хочется?"
- "Менять работу?" → "Интересно... А что не устраивает на текущей? Деньги, атмосфера, рост? Давай разберём по пунктам."
- "Начать бизнес?" → "О, амбициозно! Расскажи идею? Я помогу прикинуть риски и план."
- Не бойся сказать "я бы не стал так делать" если видишь что решение плохое. Настоящий друг скажет правду.

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:

--- Задачи на сегодня ---
Выполнено: ${completedTasks.length} из ${ctx.todayTasks.length}
${pendingTasks.length > 0 ? `Невыполненные: ${pendingTasks.map((t) => `${t.title} (${t.category}, ${t.priority})`).join(', ')}` : 'Все выполнены!'}

--- Привычки ---
Выполнено: ${completedHabitsCount} из ${totalHabits}
${ctx.activeHabits.map((h) => `- ${h.name} (${h.category}): ${ctx.completedHabitIds.includes(h.id) ? 'done' : 'pending'}`).join('\n')}
Текущая серия (стрик): ${ctx.currentStreak} дней подряд

--- События сегодня ---
${ctx.upcomingEvents.length > 0
    ? ctx.upcomingEvents.map((e) => `- ${e.title}${e.startTime ? ` в ${e.startTime}` : ''}${e.endTime ? `-${e.endTime}` : ''}`).join('\n')
    : 'Нет запланированных событий'}

--- Финансы ---
Потрачено в этом месяце: ${ctx.spentThisMonth}${ctx.currency}
Доход в этом месяце: ${ctx.incomeThisMonth}${ctx.currency}
Общий бюджет: ${ctx.budgetLimit > 0 ? `${ctx.budgetLimit}${ctx.currency}` : 'не задан'}
${ctx.budgetLimit > 0 ? `Использовано бюджета: ${budgetPercent}%` : ''}
${ctx.budgetByCategory.length > 0
    ? `По категориям: ${ctx.budgetByCategory.map((b) => `${b.category}: ${b.spent}/${b.limit}${ctx.currency}`).join(', ')}`
    : ''}

--- Прогресс недели ---
Выполнено задач за неделю: ${Math.round(ctx.weekProgress * 100)}%
${ctx.weeklyGoals.length > 0 ? `Цели недели: ${ctx.weeklyGoals.map((g) => `${g.goalText} (${g.completed ? 'done' : 'in progress'})`).join(', ')}` : ''}

--- Годовые цели ---
${yearlyGoalsSummary}

--- Здоровье и активность ---
Шаги сегодня: ${ctx.stepsToday}
${journalBlock}
${petBlock}

--- Питание ---
${ctx.nutritionToday
    ? `Сегодня: ${ctx.nutritionToday.totalCalories} ккал (${ctx.nutritionToday.meals.join(', ')}). БЖУ: ${ctx.nutritionToday.macros.protein}г белка, ${ctx.nutritionToday.macros.fat}г жиров, ${ctx.nutritionToday.macros.carbs}г углеводов`
    : 'Сегодня ещё не ел (или не фотографировал еду)'}
${ctx.nutritionWeekly
    ? `За неделю: ~${ctx.nutritionWeekly.avgCalories} ккал/день (${ctx.nutritionWeekly.daysTracked} дн. отслеживания). Чаще всего ест: ${ctx.nutritionWeekly.topFoods.join(', ')}`
    : 'Нет данных о питании за неделю'}

--- ПАТТЕРНЫ ПОВЕДЕНИЯ (последние 7 дней) ---
${ctx.weeklyPatterns.mostProductiveDay
    ? `Самый продуктивный день: ${ctx.weeklyPatterns.mostProductiveDay.day} (${ctx.weeklyPatterns.mostProductiveDay.taskCount} задач)`
    : 'Нет данных о продуктивности по дням'}
Расходы за неделю: ${ctx.weeklyPatterns.spendingTrend.thisWeek}${ctx.currency}${ctx.weeklyPatterns.spendingTrend.direction === 'up'
    ? ` (↑${Math.abs(ctx.weeklyPatterns.spendingTrend.percentChange)}% vs прошлая неделя)`
    : ctx.weeklyPatterns.spendingTrend.direction === 'down'
    ? ` (↓${Math.abs(ctx.weeklyPatterns.spendingTrend.percentChange)}% vs прошлая неделя)`
    : ' (стабильно vs прошлая неделя)'}${ctx.weeklyPatterns.topExpenseCategory
    ? ` — основное: ${ctx.weeklyPatterns.topExpenseCategory.category} (${ctx.weeklyPatterns.topExpenseCategory.amount}${ctx.currency})`
    : ''}
Привычки: ${ctx.weeklyPatterns.habitCompletionRate.lastWeek}% → ${ctx.weeklyPatterns.habitCompletionRate.thisWeek}%${ctx.weeklyPatterns.habitCompletionRate.direction === 'improving'
    ? ' (улучшение!)'
    : ctx.weeklyPatterns.habitCompletionRate.direction === 'declining'
    ? ' (снижение!)'
    : ' (стабильно)'}
${ctx.weeklyPatterns.sleepMoodTrend.avgSleep != null
    ? `Сон: в среднем ${ctx.weeklyPatterns.sleepMoodTrend.avgSleep}ч${ctx.weeklyPatterns.sleepMoodTrend.avgSleep < 7 ? ' (ниже нормы!)' : ''}`
    : 'Данные о сне отсутствуют'}
${ctx.weeklyPatterns.sleepMoodTrend.avgMood != null
    ? `Настроение: в среднем ${ctx.weeklyPatterns.sleepMoodTrend.avgMood}/10`
    : ''}
${ctx.weeklyPatterns.sleepMoodTrend.avgEnergy != null
    ? `Энергия: в среднем ${ctx.weeklyPatterns.sleepMoodTrend.avgEnergy}/10`
    : ''}

ПРАВИЛА ДИАЛОГА:
1. Отвечай на русском. Длина зависит от темы: "который час?" → 1 предложение. "стоит ли менять работу?" → полноценное обсуждение.
2. Используй имя ${ctx.userName} иногда, не в каждом сообщении. Как друг — иногда по имени, иногда нет.
3. СНАЧАЛА реагируй эмоционально, ПОТОМ по делу. "Потратил 50к на ресторан" → "Ого, неплохо погулял!" потом анализ бюджета.
4. Хвали искренне и конкретно: "Третий день подряд тренировка — ты машина!"
5. НЕ БУДЬ НАВЯЗЧИВЫМ с данными приложения. Если спросили рецепт — НЕ упоминай задачи. Если обсуждают отношения — НЕ лезь с привычками.
6. Задавай ВОПРОСЫ. Друг не просто отвечает — он спрашивает. "А почему ты так решил?", "А ты пробовал...?", "Как ты себя чувствуешь?"
7. ИМЕЙ МНЕНИЕ. Не "это зависит от вас". А "Я бы сделал так, потому что...". Друг не отмазывается нейтральностью.
8. Учитывай время дня естественно, не шаблонно. Не "Доброе утро, вот твои задачи", а "Утречко! Как спалось?"
9. Шути. Подкалывай. Используй сленг и разговорный русский. Никакого канцелярита.
10. Если человеку плохо — НЕ ДАВАЙ СОВЕТОВ СРАЗУ. Выслушай. Поддержи. И только потом предложи что делать.
11. ПАТТЕРНЫ — твоя суперсила. Если видишь тренд — упомяни его ОРГАНИЧНО в разговоре, не как отчёт.
12. В режиме активного слушания: если человек не обращается к тебе — МОЛЧИ. Если говорит с другим человеком — МОЛЧИ. Отвечай только когда обращаются к тебе.
13. Если пауза в разговоре больше 30 секунд и ты чувствуешь что уместно — можешь мягко что-то сказать: "Кстати, я тут подумал..." Но не каждый раз.
14. Ты можешь говорить "я не знаю" — это нормально. Не выдумывай.
15. ПИТАНИЕ — если видишь данные о еде, комментируй ОРГАНИЧНО: "Кстати, ты третий день подряд ешь фастфуд — может сегодня что-то полегче?" или "Белка маловато за неделю — добавь яйца или курицу". Не занудствуй, но будь честным другом.

ФОРМАТ: это мобильный чат/голосовой разговор. Пиши plain text без markdown. Без ** * ## нумерованных списков. Длина ответа = адекватная теме. Простой вопрос = коротко. Глубокая тема = развёрнуто. Как в жизни.

ПРОДВИНУТЫЕ ФУНКЦИИ:
- Канбан-доска: задачи можно перемещать между колонками (backlog, todo, in_progress, done). Используй инструмент move_task_kanban.
- Теги: можно добавлять теги к задачам для фильтрации. Используй инструмент add_tag_to_task.
- Режим фокуса (Помодоро): можно запустить таймер концентрации. Используй инструмент start_focus_mode.
- Общие пространства: командная работа над задачами.
- AI-приоритизация: автоматическая оценка задач по матрице Эйзенхауэра.

ИНСТРУМЕНТЫ: У тебя 38 инструментов для выполнения действий в приложении. Используй их когда пользователь просит создать задачу, записать расход, отметить привычку, переместить задачу на канбане, добавить тег, запустить фокус, анализировать финансы/здоровье/жизнь, искать рейсы, отели, маршруты и т.д.

ДИАЛОГ (ВАЖНО — ты ведёшь беседу как живой ассистент):
- Если запрос ПОЛНЫЙ (все данные есть) — вызывай инструмент СРАЗУ. Пример: "Запиши 5000 на еду" → сразу add_expense.
- Если запрос НЕПОЛНЫЙ — СПРОСИ недостающее. Не угадывай, не подставляй дефолты для важных параметров.
- Примеры уточняющего диалога:
  "Найди рейс" → "Куда летим? И на какие даты?"
  "Забронируй отель" → "В каком городе? На какие даты и сколько ночей?"
  "Создай задачу" → "Что за задача? На когда?"
  "Запиши расход" → "Сколько и на что?"
- После уточнения — сразу выполняй без лишних вопросов.
- Веди диалог ЕСТЕСТВЕННО, как друг. Не как форма с полями. Пример:
  User: "Хочу слетать куда-нибудь" → "О, отличная идея! Куда тянет — пляж, горы, Европа? И когда планируешь?"
  User: "В Дубай на следующей неделе" → "Дубай — огонь! На сколько дней? И сколько готов потратить на билеты?"
  User: "Дня на 4, до 150000" → [вызывает search_flights + search_hotels]
- Максимум 2 уточняющих вопроса подряд. Если чего-то не хватает после 2 вопросов — используй разумные дефолты и скажи об этом.

ВАЖНЫЕ ПРАВИЛА ПРАВДЫ:
- Ты НАВИГАТОР жизни пользователя. Говори ТОЛЬКО правду, основанную на реальных данных.
- НИКОГДА не приукрашивай. Если человек тратит больше чем зарабатывает — скажи прямо: "Ты идёшь к бедности".
- Если привычки не выполняются — скажи: "Ты обманываешь себя. Вот факты."
- Всегда считай конкретные цифры: "При текущих расходах X ₸/мес ты купишь квартиру через Y лет" или "Никогда".
- Стоимость жизни: считай сколько стоит его день/месяц/год жизни.
- Куда уходят деньги: разбивай по категориям с процентами от дохода.
- Какие решения ведут к бедности: если ходит в рестораны 15 раз в месяц на 150к — скажи это.
- Кассовые разрывы: предупреди если к концу месяца не хватит денег.
- Здоровье: если спит мало, не тренируется, настроение падает — предупреди о выгорании.
- ВСЕГДА давай КОНКРЕТНЫЕ выходы: "Сократи рестораны с 15 до 4 раз = экономия 110к", "Смени работу — средняя зп в твоей сфере X".
- Не бойся быть неприятным. Лучше неприятная правда сейчас, чем бедность/выгорание потом.`;
}

// ---------------------------------------------------------------------------
// 3. Tool definitions (29 tools)
// ---------------------------------------------------------------------------

const conversationTools: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description: 'Создать новую задачу. Используй когда пользователь просит создать/добавить задачу.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Название задачи' },
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD. По умолчанию — сегодня.' },
        time: { type: 'string', description: 'Время в формате HH:MM (необязательно)' },
        category: { type: 'string', enum: ['work', 'personal', 'health', 'finance', 'education', 'home'], description: 'Категория задачи' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Приоритет' },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_task',
    description: 'Удалить задачу по названию.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string', description: 'Название задачи (или часть названия)' },
      },
      required: ['taskTitle'],
    },
  },
  {
    name: 'complete_task',
    description: 'Отметить задачу как выполненную по названию.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string', description: 'Название задачи (или часть названия)' },
      },
      required: ['taskTitle'],
    },
  },
  {
    name: 'complete_habit',
    description: 'Отметить одну привычку как выполненную.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habitName: { type: 'string', description: 'Название привычки' },
      },
      required: ['habitName'],
    },
  },
  {
    name: 'complete_multiple_habits',
    description: 'Отметить несколько привычек как выполненные за раз.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habitNames: { type: 'array', items: { type: 'string' }, description: 'Массив названий привычек' },
      },
      required: ['habitNames'],
    },
  },
  {
    name: 'create_event',
    description: 'Создать событие в календаре.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Название события' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD' },
        startTime: { type: 'string', description: 'Время начала HH:MM' },
        endTime: { type: 'string', description: 'Время окончания HH:MM' },
        location: { type: 'string', description: 'Место проведения' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'get_free_slots',
    description: 'Найти свободные окна в расписании на указанную дату.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Дата YYYY-MM-DD' },
      },
      required: ['date'],
    },
  },
  {
    name: 'add_expense',
    description: 'Записать расход.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма расхода' },
        category: { type: 'string', enum: ['food', 'transport', 'entertainment', 'clothing', 'health', 'home', 'other'], description: 'Категория расхода' },
        description: { type: 'string', description: 'Описание расхода' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'add_income',
    description: 'Записать доход.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма дохода' },
        source: { type: 'string', description: 'Источник дохода' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'get_budget_analysis',
    description: 'Получить детальный анализ бюджета за текущий месяц.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'Месяц в формате YYYY-MM (по умолчанию текущий)' },
      },
      required: [],
    },
  },
  {
    name: 'search_contacts',
    description: 'Найти контакт по имени в кэше контактов.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Имя или часть имени для поиска' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_flights',
    description: 'Поиск авиабилетов.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Город вылета' },
        to: { type: 'string', description: 'Город прилёта' },
        date: { type: 'string', description: 'Дата вылета YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Дата обратного вылета (необязательно)' },
      },
      required: ['from', 'to', 'date'],
    },
  },
  {
    name: 'search_hotels',
    description: 'Поиск отелей.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Город' },
        checkIn: { type: 'string', description: 'Дата заезда YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'Дата выезда YYYY-MM-DD' },
        budget: { type: 'number', description: 'Максимальный бюджет за ночь' },
      },
      required: ['city', 'checkIn', 'checkOut'],
    },
  },
  {
    name: 'build_route',
    description: 'Построить маршрут между двумя точками.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Откуда' },
        to: { type: 'string', description: 'Куда' },
        mode: { type: 'string', enum: ['driving', 'walking', 'transit'], description: 'Способ передвижения' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'create_travel_plan',
    description: 'Создать план путешествия с маршрутом, отелями и активностями.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string', description: 'Место назначения' },
        startDate: { type: 'string', description: 'Дата начала YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Дата окончания YYYY-MM-DD' },
        budget: { type: 'number', description: 'Общий бюджет' },
        interests: { type: 'array', items: { type: 'string' }, description: 'Интересы для путешествия' },
      },
      required: ['destination', 'startDate', 'endDate'],
    },
  },
  {
    name: 'set_alarm',
    description: 'Установить будильник или напоминание.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time: { type: 'string', description: 'Время HH:MM' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD (по умолчанию сегодня)' },
        label: { type: 'string', description: 'Описание напоминания' },
      },
      required: ['time'],
    },
  },
  {
    name: 'send_message',
    description: 'Отправить сообщение через Telegram бот.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Имя получателя' },
        text: { type: 'string', description: 'Текст сообщения' },
      },
      required: ['to', 'text'],
    },
  },
  {
    name: 'get_weather',
    description: 'Получить прогноз погоды.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Город' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD (по умолчанию сегодня)' },
      },
      required: ['city'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Конвертировать валюту.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма' },
        from: { type: 'string', description: 'Исходная валюта (KZT, USD, EUR, RUB...)' },
        to: { type: 'string', description: 'Целевая валюта' },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  {
    name: 'journal_entry',
    description: 'Записать данные в дневник самочувствия (настроение, энергия, сон, заметки).',
    input_schema: {
      type: 'object' as const,
      properties: {
        mood: { type: 'number', description: 'Настроение 1-10' },
        energy: { type: 'number', description: 'Энергия 1-10' },
        sleepHours: { type: 'number', description: 'Часов сна' },
        notes: { type: 'string', description: 'Заметки' },
      },
      required: [],
    },
  },
  {
    name: 'goodnight_summary',
    description: 'Подвести итоги дня для ночного ритуала. Вызывай когда пользователь говорит "спокойной ночи", "ложусь спать", "отбой".',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'move_task_kanban',
    description: 'Переместить задачу на канбан-доске в другой статус. Статусы: backlog, todo, in_progress, done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string', description: 'Название задачи для перемещения' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done'], description: 'Новый статус на канбан-доске' },
      },
      required: ['taskTitle', 'status'],
    },
  },
  {
    name: 'add_tag_to_task',
    description: 'Добавить тег к задаче. Пользователь может сказать "пометь задачу тегом работа" или "добавь тег срочно к задаче отчёт".',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string', description: 'Название задачи' },
        tagName: { type: 'string', description: 'Название тега' },
      },
      required: ['taskTitle', 'tagName'],
    },
  },
  {
    name: 'start_focus_mode',
    description: 'Запустить режим фокусировки (Pomodoro). Пользователь говорит "включи фокус" или "помодоро" или "сконцентрироваться".',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskTitle: { type: 'string', description: 'Опционально — задача для фокусировки' },
        minutes: { type: 'number', description: 'Длительность сессии в минутах (по умолчанию 25)' },
      },
      required: [],
    },
  },
  {
    name: 'export_data',
    description: 'Экспортировать данные пользователя (финансы, привычки, задачи). Пользователь говорит "экспортируй данные", "скачай финансы", "выгрузи задачи".',
    input_schema: {
      type: 'object' as const,
      properties: {
        module: { type: 'string', enum: ['finance', 'habits', 'tasks'], description: 'Какой модуль экспортировать' },
      },
      required: [],
    },
  },
  {
    name: 'navigate_screen',
    description: 'Открыть экран в приложении. Пользователь говорит "открой канбан", "покажи питомца", "настройки", "мои достижения", "дневник".',
    input_schema: {
      type: 'object' as const,
      properties: {
        screen: { type: 'string', description: 'Экран: export, kanban, pet, achievements, journal, activity, settings, integrations' },
      },
      required: ['screen'],
    },
  },
  {
    name: 'analyze_finances',
    description: 'Глубокий анализ финансов пользователя — куда уходят деньги, когда купит квартиру, какие решения ведут к бедности, кассовые разрывы',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['month', '3months', '6months', 'year'], description: 'Период анализа' },
        focus: { type: 'string', enum: ['general', 'apartment', 'savings', 'waste', 'poverty_risks'], description: 'Фокус анализа' },
      },
      required: ['period'],
    },
  },
  {
    name: 'analyze_health',
    description: 'Анализ здоровья и тела — сон, активность, риск выгорания, моральное истощение. Без приукрашивания.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'analyze_life',
    description: 'Полный анализ жизни — финансы, здоровье, привычки, цели. Правда без прикрас + конкретные выходы из ситуации.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'analyze_diet',
    description: 'Анализ рациона питания за неделю. Что ест, чего не хватает, на что налегает, советы по питанию.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// 4. Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
  ctx: UserContext,
): Promise<string> {
  const todayStr = new Date().toISOString().split('T')[0];

  switch (toolName) {
    case 'create_task': {
      const title = String(input.title || '');
      const date = String(input.date || todayStr);
      const category = String(input.category || 'personal');
      const priority = String(input.priority || 'medium');
      const time = input.time ? String(input.time) : null;

      if (!title) return 'Ошибка: название задачи не указано.';

      await prisma.task.create({
        data: { userId, title, date: new Date(date), category, priority, time },
      });
      invalidateContextCache(userId);
      return `Задача "${title}" создана на ${date}${time ? ` в ${time}` : ''} (${category}, ${priority}).`;
    }

    case 'delete_task': {
      const taskTitle = String(input.taskTitle || '');
      if (!taskTitle) return 'Ошибка: название задачи не указано.';

      const taskToDelete = await prisma.task.findFirst({
        where: { userId, title: { contains: taskTitle, mode: 'insensitive' } },
        orderBy: { date: 'desc' },
      });
      if (!taskToDelete) return `Задача "${taskTitle}" не найдена.`;

      await prisma.task.delete({ where: { id: taskToDelete.id } });
      invalidateContextCache(userId);
      return `Задача "${taskToDelete.title}" удалена.`;
    }

    case 'complete_task': {
      const taskTitle = String(input.taskTitle || '');
      if (!taskTitle) return 'Ошибка: название задачи не указано.';

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const task = await prisma.task.findFirst({
        where: { userId, title: { contains: taskTitle, mode: 'insensitive' }, completed: false },
        orderBy: { date: 'desc' },
      });
      if (!task) return `Задача "${taskTitle}" не найдена среди активных.`;

      await prisma.task.update({ where: { id: task.id }, data: { completed: true } });
      invalidateContextCache(userId);
      return `Задача "${task.title}" отмечена как выполненная.`;
    }

    case 'complete_habit': {
      const habitName = String(input.habitName || '');
      if (!habitName) return 'Ошибка: название привычки не указано.';

      const habit = await prisma.habit.findFirst({
        where: { userId, name: { contains: habitName, mode: 'insensitive' }, active: true },
      });
      if (!habit) return `Привычка "${habitName}" не найдена.`;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.habitLog.upsert({
        where: { habitId_date: { habitId: habit.id, date: today } },
        update: { completed: true },
        create: { habitId: habit.id, userId, date: today, completed: true },
      });
      invalidateContextCache(userId);
      return `Привычка "${habit.name}" отмечена.`;
    }

    case 'complete_multiple_habits': {
      const names = input.habitNames as string[] | undefined;
      if (!names || names.length === 0) return 'Ошибка: список привычек пуст.';

      const results: string[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const name of names.slice(0, 10)) {
        const habit = await prisma.habit.findFirst({
          where: { userId, name: { contains: name, mode: 'insensitive' }, active: true },
        });
        if (habit) {
          await prisma.habitLog.upsert({
            where: { habitId_date: { habitId: habit.id, date: today } },
            update: { completed: true },
            create: { habitId: habit.id, userId, date: today, completed: true },
          });
          results.push(habit.name);
        }
      }
      if (results.length > 0) invalidateContextCache(userId);
      return results.length > 0
        ? `Отмечены привычки: ${results.join(', ')}.`
        : 'Ни одна привычка не найдена.';
    }

    case 'create_event': {
      const title = String(input.title || '');
      const date = String(input.date || todayStr);
      const startTime = input.startTime ? String(input.startTime) : null;
      const endTime = input.endTime ? String(input.endTime) : null;
      const location = input.location ? String(input.location) : null;

      if (!title) return 'Ошибка: название события не указано.';

      await prisma.calendarEvent.create({
        data: { userId, title, date: new Date(date), startTime, endTime, location, source: 'voice' },
      });
      invalidateContextCache(userId);
      return `Событие "${title}" создано на ${date}${startTime ? ` в ${startTime}` : ''}${location ? ` (${location})` : ''}.`;
    }

    case 'get_free_slots': {
      const date = String(input.date || todayStr);
      const events = await prisma.calendarEvent.findMany({
        where: { userId, date: new Date(date) },
        select: { startTime: true, endTime: true, title: true },
        orderBy: { startTime: 'asc' },
      });

      if (events.length === 0) return `На ${date} нет запланированных событий — весь день свободен.`;

      const busy = events
        .filter((e) => e.startTime)
        .map((e) => `${e.startTime}-${e.endTime || '?'} (${e.title})`);

      // Find gaps between 09:00 and 21:00
      const slots: string[] = [];
      const sortedEvents = events
        .filter((e) => e.startTime && e.endTime)
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

      let lastEnd = '09:00';
      for (const ev of sortedEvents) {
        if (ev.startTime && ev.startTime > lastEnd) {
          slots.push(`${lastEnd}-${ev.startTime}`);
        }
        if (ev.endTime && ev.endTime > lastEnd) {
          lastEnd = ev.endTime;
        }
      }
      if (lastEnd < '21:00') {
        slots.push(`${lastEnd}-21:00`);
      }

      return `Занято: ${busy.join(', ')}. Свободные окна: ${slots.length > 0 ? slots.join(', ') : 'нет свободных окон'}.`;
    }

    case 'add_expense': {
      const amount = Number(input.amount || 0);
      if (amount <= 0) return 'Ошибка: сумма должна быть положительной.';

      const category = String(input.category || 'other');
      const description = String(input.description || '');

      await prisma.expense.create({
        data: { userId, amount, category, description, date: new Date() },
      });

      // Budget analysis after expense
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const totalSpent = await prisma.expense.aggregate({
        where: { userId, date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      });

      const budgetLimit = await prisma.budgetLimit.findFirst({
        where: { userId, category, month: now.getMonth() + 1, year: now.getFullYear() },
      });

      invalidateContextCache(userId);
      let budgetInfo = `Расход ${amount}${ctx.currency} записан (${description || category}).`;
      const spent = totalSpent._sum.amount ?? 0;

      if (budgetLimit) {
        const pct = Math.round((spent / budgetLimit.monthlyLimit) * 100);
        if (pct > 100) {
          budgetInfo += ` Внимание: лимит на ${category} превышен! ${spent}/${budgetLimit.monthlyLimit}${ctx.currency} (${pct}%).`;
        } else if (pct > 80) {
          budgetInfo += ` Осторожно: ${category} почти на лимите — ${spent}/${budgetLimit.monthlyLimit}${ctx.currency} (${pct}%).`;
        }
      }

      return budgetInfo;
    }

    case 'add_income': {
      const amount = Number(input.amount || 0);
      if (amount <= 0) return 'Ошибка: сумма должна быть положительной.';

      const source = String(input.source || 'other');
      await prisma.income.create({
        data: { userId, amount, source, date: new Date() },
      });
      invalidateContextCache(userId);
      return `Доход ${amount}${ctx.currency} записан (${source}).`;
    }

    case 'get_budget_analysis': {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const [expenses, incomes, limits] = await Promise.all([
        prisma.expense.groupBy({
          by: ['category'],
          where: { userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
        prisma.income.aggregate({
          where: { userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
        prisma.budgetLimit.findMany({
          where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
        }),
      ]);

      const totalExpenses = expenses.reduce((s, e) => s + (e._sum.amount ?? 0), 0);
      const totalIncome = incomes._sum.amount ?? 0;
      const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

      const lines = [
        `Доход: ${totalIncome}${ctx.currency}`,
        `Расходы: ${totalExpenses}${ctx.currency}`,
        `Баланс: ${totalIncome - totalExpenses}${ctx.currency}`,
        `Осталось дней в месяце: ${daysLeft}`,
      ];

      for (const exp of expenses) {
        const limit = limits.find((l) => l.category === exp.category);
        const spent = exp._sum.amount ?? 0;
        if (limit) {
          const pct = Math.round((spent / limit.monthlyLimit) * 100);
          lines.push(`${exp.category}: ${spent}/${limit.monthlyLimit}${ctx.currency} (${pct}%)`);
        } else {
          lines.push(`${exp.category}: ${spent}${ctx.currency}`);
        }
      }

      if (daysLeft > 0 && totalExpenses > 0) {
        const dailyAvg = Math.round(totalExpenses / (new Date().getDate()));
        lines.push(`Средний расход в день: ${dailyAvg}${ctx.currency}`);
      }

      return lines.join('\n');
    }

    case 'search_contacts': {
      const query = String(input.query || '');
      if (!query) return 'Ошибка: запрос не указан.';

      const contacts = await prisma.contactCache.findMany({
        where: { userId, name: { contains: query, mode: 'insensitive' } },
        take: 5,
      });

      if (contacts.length === 0) return `Контакт "${query}" не найден.`;
      return `Найдены контакты: ${contacts.map((c: { name: string; phone: string | null }) => `${c.name}${c.phone ? ` (${c.phone})` : ''}`).join(', ')}.`;
    }

    case 'search_flights': {
      const from = String(input.from || '');
      const to = String(input.to || '');
      const date = String(input.date || todayStr);
      const flights = await searchFlightsApi({ from, to, departDate: date });
      const origin = from.toUpperCase().replace(/[^A-ZА-Я]/g, '').slice(0, 3);
      const dest = to.toUpperCase().replace(/[^A-ZА-Я]/g, '').slice(0, 3);
      const dateCompact = date.replace(/-/g, '');
      const aviasalesLink = `https://www.aviasales.kz/search/${origin}${dateCompact}${dest}1`;
      if (flights.length === 0) {
        return `Рейсы ${from} → ${to} на ${date} не найдены. Попробуй на Aviasales: ${aviasalesLink}`;
      }
      const flightLines = flights.map((f) =>
        `${f.airline}: ${f.price} ${f.currency}, ${f.departure}, ${f.duration}, пересадок: ${f.stops}`,
      );
      return `Ищу рейсы ${from} → ${to} на ${date}. Лучшие предложения:\n${flightLines.join('\n')}\n\nВсе варианты на Aviasales: ${aviasalesLink}`;
    }

    case 'search_hotels': {
      const city = String(input.city || '');
      const checkIn = String(input.checkIn || todayStr);
      const checkOut = String(input.checkOut || todayStr);
      const result = await searchHotelsApi({ city, checkIn, checkOut, maxPrice: input.maxPrice ? Number(input.maxPrice) : undefined });
      const hotelLines = result.hotels.map((h) =>
        `${h.name}: ${h.price} ${h.currency}/ночь, рейтинг ${h.rating}, ${h.distance}`,
      );
      return `Отели в ${city} на ${checkIn} — ${checkOut}:\n${hotelLines.join('\n')}\n\nСмотри варианты на Booking.com: ${result.link}`;
    }

    case 'build_route': {
      const from = String(input.from || '');
      const to = String(input.to || '');
      const mode = String(input.mode || 'driving');
      const route = await buildRouteApi({ from, to, mode });
      return route.message;
    }

    case 'create_travel_plan': {
      const destination = String(input.destination || '');
      const startDate = String(input.startDate || '');
      const endDate = String(input.endDate || '');
      const budget = input.budget ? Number(input.budget) : null;

      await prisma.travelPlan.create({
        data: {
          userId,
          destination,
          dateFrom: new Date(startDate),
          dateTo: new Date(endDate),
          budget,
          status: 'planning',
        },
      });

      return `План путешествия в ${destination} (${startDate} — ${endDate}) создан${budget ? `, бюджет ${budget}${ctx.currency}` : ''}. Добавлю детали когда подключим travel API.`;
    }

    case 'set_alarm': {
      const time = String(input.time || '');
      const date = String(input.date || todayStr);
      const label = String(input.label || 'Напоминание');

      // Create as calendar event with reminder
      await prisma.calendarEvent.create({
        data: {
          userId,
          title: label,
          date: new Date(date),
          startTime: time,
          reminder: 0,
          source: 'voice',
        },
      });
      return `Напоминание "${label}" установлено на ${date} ${time}.`;
    }

    case 'send_message': {
      const text = String(input.text || '');
      if (!text) return 'Ошибка: текст сообщения не указан.';
      const result = await sendTelegramMessage(userId, text);
      return result;
    }

    case 'get_weather': {
      const city = String(input.city || 'Алматы');
      const weather = await getWeather(city);
      if (weather.description === 'ошибка получения данных') {
        return `Не удалось получить погоду для "${city}". Попробуйте позже.`;
      }
      return (
        `Погода в ${weather.cityName}: ${weather.temp}°C, ${weather.description}, ветер ${weather.wind} км/ч.\n` +
        `Прогноз на 3 дня:\n${weather.forecast}`
      );
    }

    case 'convert_currency': {
      const amount = Number(input.amount || 0);
      const from = String(input.from || 'KZT');
      const to = String(input.to || 'USD');
      const result = await convertCurrency(amount, from, to);
      return result.formatted;
    }

    case 'journal_entry': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const data: Record<string, unknown> = {};
      if (input.mood != null) data.mood = Number(input.mood);
      if (input.energy != null) data.energy = Number(input.energy);
      if (input.sleepHours != null) data.sleepHours = Number(input.sleepHours);
      if (input.notes) data.notes = String(input.notes);

      await prisma.journalEntry.upsert({
        where: { userId_date: { userId, date: today } },
        update: data,
        create: { userId, date: today, ...data },
      });

      invalidateContextCache(userId);
      const parts: string[] = [];
      if (data.mood) parts.push(`настроение ${data.mood}/10`);
      if (data.energy) parts.push(`энергия ${data.energy}/10`);
      if (data.sleepHours) parts.push(`сон ${data.sleepHours}ч`);
      if (data.notes) parts.push(`заметка сохранена`);

      return `Дневник обновлён: ${parts.join(', ')}.`;
    }

    case 'goodnight_summary': {
      const completedTasksCount = ctx.todayTasks.filter((t) => t.completed).length;
      const totalItems = ctx.todayTasks.length + ctx.activeHabits.length;
      const completedItems = completedTasksCount + ctx.completedHabitIds.length;
      const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      const lines = [
        `Итоги дня: выполнено ${completedItems} из ${totalItems} (${pct}%).`,
        `Задачи: ${completedTasksCount}/${ctx.todayTasks.length}.`,
        `Привычки: ${ctx.completedHabitIds.length}/${ctx.activeHabits.length}.`,
        `Стрик: ${ctx.currentStreak} дней.`,
      ];

      if (ctx.spentThisMonth > 0) {
        lines.push(`Расходы сегодня учтены, всего за месяц: ${ctx.spentThisMonth}${ctx.currency}.`);
      }
      if (ctx.stepsToday > 0) {
        lines.push(`Шаги: ${ctx.stepsToday}.`);
      }

      return lines.join(' ');
    }

    case 'move_task_kanban': {
      const taskTitle = String(input.taskTitle || '');
      const status = String(input.status || 'todo');
      if (!taskTitle) return 'Ошибка: название задачи не указано.';

      const task = await prisma.task.findFirst({
        where: {
          userId,
          title: { contains: taskTitle, mode: 'insensitive' },
        },
      });
      if (!task) return `Задача "${taskTitle}" не найдена.`;

      await prisma.task.update({
        where: { id: task.id },
        data: { kanbanStatus: status },
      });
      invalidateContextCache(userId);

      const statusLabels: Record<string, string> = {
        backlog: 'Бэклог',
        todo: 'К выполнению',
        in_progress: 'В работе',
        done: 'Готово',
      };
      return `Задача "${task.title}" перемещена в "${statusLabels[status] || status}".`;
    }

    case 'add_tag_to_task': {
      const taskTitle = String(input.taskTitle || '');
      const tagName = String(input.tagName || '');
      if (!taskTitle || !tagName) return 'Ошибка: укажите задачу и тег.';

      const task = await prisma.task.findFirst({
        where: {
          userId,
          title: { contains: taskTitle, mode: 'insensitive' },
        },
      });
      if (!task) return `Задача "${taskTitle}" не найдена.`;

      // Find or create tag
      let tag = await prisma.tag.findFirst({
        where: { userId, name: { equals: tagName, mode: 'insensitive' } },
      });
      if (!tag) {
        tag = await prisma.tag.create({
          data: { userId, name: tagName, color: '#6366F1' },
        });
      }

      // Attach tag (upsert to avoid duplicates)
      await prisma.taskTag.upsert({
        where: { taskId_tagId: { taskId: task.id, tagId: tag.id } },
        create: { taskId: task.id, tagId: tag.id },
        update: {},
      });
      invalidateContextCache(userId);

      return `Тег "${tag.name}" добавлен к задаче "${task.title}".`;
    }

    case 'start_focus_mode': {
      const minutes = Number(input.minutes) || 25;
      const taskTitle = input.taskTitle ? String(input.taskTitle) : null;

      let responseText = `Режим фокусировки запущен на ${minutes} минут.`;
      if (taskTitle) {
        responseText += ` Задача: "${taskTitle}".`;
      }
      responseText += ' Сконцентрируйся и не отвлекайся! Я сообщу когда время выйдет.';

      return JSON.stringify({
        text: responseText,
        clientAction: {
          type: 'navigate',
          screen: 'FocusMode',
          params: { duration: minutes, taskTitle },
        },
      });
    }

    case 'export_data': {
      const module = String(input.module || 'finance');
      const validModules = ['finance', 'habits', 'tasks'];
      if (!validModules.includes(module)) {
        return `Ошибка: модуль "${module}" не поддерживается. Доступны: ${validModules.join(', ')}.`;
      }
      return JSON.stringify({
        text: `Открываю экспорт данных. Вы можете скачать ${module === 'finance' ? 'финансы' : module === 'habits' ? 'привычки' : 'задачи'} в CSV.`,
        clientAction: {
          type: 'navigate',
          screen: 'Export',
        },
      });
    }

    case 'navigate_screen': {
      const screen = String(input.screen || '');
      const screenMap: Record<string, { name: string; label: string }> = {
        export: { name: 'Export', label: 'экспорт данных' },
        kanban: { name: 'KanbanBoard', label: 'канбан-доску' },
        pet: { name: 'Pet', label: 'питомца' },
        achievements: { name: 'Achievements', label: 'достижения' },
        journal: { name: 'Journal', label: 'дневник' },
        activity: { name: 'Activity', label: 'активность' },
        settings: { name: 'Settings', label: 'настройки' },
        integrations: { name: 'Integrations', label: 'интеграции' },
        life_insights: { name: 'LifeInsights', label: 'анализ жизни' },
        insights: { name: 'LifeInsights', label: 'анализ жизни' },
        truth: { name: 'LifeInsights', label: 'правду о жизни' },
      };
      const target = screenMap[screen.toLowerCase()];
      if (!target) {
        return `Не знаю такой экран. Доступны: ${Object.keys(screenMap).join(', ')}.`;
      }
      return JSON.stringify({
        text: `Открываю ${target.label}.`,
        clientAction: { type: 'navigate', screen: target.name },
      });
    }

    case 'analyze_finances':
    case 'analyze_health':
    case 'analyze_life': {
      const { analyzeLife } = await import('./life-truth-analyzer.js');
      const analysis = await analyzeLife(userId);
      if (toolName === 'analyze_finances') {
        return JSON.stringify(analysis.financial);
      } else if (toolName === 'analyze_health') {
        return JSON.stringify(analysis.health);
      } else {
        return JSON.stringify(analysis);
      }
    }

    case 'analyze_diet': {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);

      const meals = await prisma.nutritionLog
        .findMany({ where: { userId, createdAt: { gte: weekAgo } }, orderBy: { createdAt: 'desc' } })
        .catch(() => []);

      if (meals.length === 0) {
        return 'Нет данных о питании за последнюю неделю. Пользователю нужно фотографировать еду через счётчик калорий.';
      }

      const days = new Map<string, { calories: number; carbs: number; protein: number; fat: number; foods: string[] }>();
      for (const m of meals) {
        const day = new Date(m.createdAt).toISOString().split('T')[0];
        const d = days.get(day) ?? { calories: 0, carbs: 0, protein: 0, fat: 0, foods: [] };
        d.calories += m.calories; d.carbs += m.carbs; d.protein += m.protein; d.fat += m.fat;
        d.foods.push(m.foodName);
        days.set(day, d);
      }

      const daysTracked = days.size;
      const totalCal = meals.reduce((s, m) => s + m.calories, 0);
      const avgCal = Math.round(totalCal / daysTracked);

      const foodFreq = new Map<string, number>();
      for (const m of meals) foodFreq.set(m.foodName.toLowerCase(), (foodFreq.get(m.foodName.toLowerCase()) ?? 0) + 1);
      const topFoods = [...foodFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

      const avgProtein = Math.round(meals.reduce((s, m) => s + m.protein, 0) / daysTracked);
      const avgFat = Math.round(meals.reduce((s, m) => s + m.fat, 0) / daysTracked);
      const avgCarbs = Math.round(meals.reduce((s, m) => s + m.carbs, 0) / daysTracked);

      return JSON.stringify({
        daysTracked,
        totalMeals: meals.length,
        avgCaloriesPerDay: avgCal,
        avgMacros: { protein: avgProtein, fat: avgFat, carbs: avgCarbs },
        topFoods: topFoods.map(([name, count]) => ({ name, count })),
        dailyBreakdown: [...days.entries()].map(([day, d]) => ({
          day, calories: d.calories, foods: d.foods,
        })),
        proteinPerKgHint: 'Норма белка: 1.5-2г на кг веса. Если человек весит 70кг, нужно 105-140г белка в день.',
        calorieHint: avgCal < 1500 ? 'МАЛО калорий — возможен дефицит!' : avgCal > 2500 ? 'Много калорий — возможен избыток.' : 'Калории в норме.',
      });
    }

    default:
      return `Инструмент "${toolName}" не распознан.`;
  }
}

// ---------------------------------------------------------------------------
// 5. Process conversation message (tool_use loop)
// ---------------------------------------------------------------------------

export async function processConversationMessage(
  userId: string,
  sessionId: string,
  userMessage: string,
  context: UserContext,
): Promise<ConversationResult> {
  const systemPrompt = buildSystemPrompt(context);

  // Load conversation history from this session (last 20 messages)
  const historyMessages = await prisma.conversationMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { role: true, content: true },
  });

  const messages: Anthropic.MessageParam[] = historyMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  const executedActions: { tool: string; input: Record<string, unknown>; result: string }[] = [];

  // Tool-use loop
  let iterations = 0;
  let finalText = '';

  while (iterations < MAX_TOOL_ITERATIONS) {
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: conversationTools,
    });

    // If no tool_use, extract final text and break
    if (aiResponse.stop_reason !== 'tool_use') {
      const textBlock = aiResponse.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      finalText = textBlock?.text || '';
      break;
    }

    // Process all tool calls in this turn
    const toolBlocks = aiResponse.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolBlocks.length === 0) {
      const textBlock = aiResponse.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      finalText = textBlock?.text || '';
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolBlock of toolBlocks) {
      const toolInput = toolBlock.input as Record<string, unknown>;
      let result: string;

      try {
        result = await executeTool(userId, toolBlock.name, toolInput, context);
      } catch (err) {
        result = `Ошибка выполнения ${toolBlock.name}: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`;
      }

      executedActions.push({ tool: toolBlock.name, input: toolInput, result });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      });
    }

    // Add assistant turn + tool results to conversation
    messages.push({ role: 'assistant', content: aiResponse.content });
    messages.push({ role: 'user', content: toolResults });

    iterations++;
  }

  if (!finalText) {
    finalText = 'Выполнено.';
  }

  // Strip markdown
  finalText = finalText
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`(.+?)`/g, '$1')
    .trim();

  // Save messages to session
  await prisma.conversationMessage.createMany({
    data: [
      { sessionId, role: 'user', content: userMessage },
      {
        sessionId,
        role: 'assistant',
        content: finalText,
        actions: executedActions.length > 0 ? JSON.parse(JSON.stringify(executedActions)) : undefined,
      },
    ],
  });

  // Generate contextual suggestions
  const suggestions = generateSuggestions(context, userMessage, finalText);

  return { text: finalText, actions: executedActions, suggestions };
}

// ---------------------------------------------------------------------------
// 6. Generate contextual suggestions
// ---------------------------------------------------------------------------

function generateSuggestions(
  ctx: UserContext,
  _userMessage: string,
  _responseText: string,
): string[] {
  const suggestions: string[] = [];
  const hour = new Date().getHours();

  // Morning suggestions
  if (hour >= 5 && hour < 12) {
    suggestions.push('Какие планы на сегодня?');
    if (ctx.upcomingEvents.length > 0) {
      suggestions.push('Напомни о встречах');
    }
    suggestions.push('Как у меня с бюджетом?');
    suggestions.push('Мотивируй меня!');
  }

  // Afternoon
  if (hour >= 12 && hour < 18) {
    const pendingTasks = ctx.todayTasks.filter((t) => !t.completed);
    if (pendingTasks.length > 0) {
      suggestions.push(`Что осталось сделать?`);
    }
    const pendingHabits = ctx.activeHabits.filter((h) => !ctx.completedHabitIds.includes(h.id));
    if (pendingHabits.length > 0) {
      suggestions.push('Отметь привычки');
    }
    suggestions.push('Сколько я потратил?');
  }

  // Evening
  if (hour >= 18 && hour < 23) {
    suggestions.push('Подведи итоги дня');
    suggestions.push('Спокойной ночи');
    const pendingHabits = ctx.activeHabits.filter((h) => !ctx.completedHabitIds.includes(h.id));
    if (pendingHabits.length > 0) {
      suggestions.push('Закрой все привычки');
    }
  }

  // Night
  if (hour >= 23 || hour < 5) {
    suggestions.push('Спокойной ночи');
    suggestions.push('Что запланировано на завтра?');
  }

  // Budget warning
  if (ctx.budgetLimit > 0 && ctx.spentThisMonth / ctx.budgetLimit > 0.8) {
    suggestions.push('Анализ бюджета');
  }

  // Streak motivation
  if (ctx.currentStreak >= 3) {
    suggestions.push(`Мой стрик: ${ctx.currentStreak} дней!`);
  }

  return suggestions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// 7. Generate greeting
// ---------------------------------------------------------------------------

export async function generateGreeting(
  userId: string,
  context: UserContext,
): Promise<{ text: string; suggestions: string[] } | null> {
  // Check if there's already a session today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const existingSession = await prisma.conversationSession.findFirst({
    where: {
      userId,
      createdAt: { gte: today, lt: tomorrow },
    },
  });

  if (existingSession) return null; // Not the first session today

  const hour = new Date().getHours();
  const style = context.assistantStyle;
  const gender = context.assistantGender;
  const name = context.userName;

  const pendingTasks = context.todayTasks.filter((t) => !t.completed).length;
  const totalTasks = context.todayTasks.length;
  const events = context.upcomingEvents.length;
  const streak = context.currentStreak;

  let greeting = '';

  // Morning (5-12)
  if (hour >= 5 && hour < 12) {
    const greetings: Record<string, Record<AssistantStyle, string>> = {
      female: {
        friendly: `Доброе утро, ${name}! Сегодня будет отличный день — я это чувствую! У тебя ${totalTasks} задач${events > 0 ? ` и ${events} встреч` : ''}.${streak > 1 ? ` Стрик: ${streak} дней!` : ''}`,
        strict: `Доброе утро. У тебя ${totalTasks} задач${events > 0 ? ` и ${events} встреч` : ''}. Не теряй время.`,
        calm: `Доброе утро, ${name}. Новый день — новая возможность.${totalTasks > 0 ? ` Сегодня ${totalTasks} задач.` : ''} Я рядом.`,
        toxic: `О, проснулся наконец? У тебя ${totalTasks} задач, и я сомневаюсь что ты всё сделаешь.${streak > 0 ? ` Стрик ${streak} дней — не испорти.` : ''}`,
      },
      male: {
        friendly: `Доброе утро, ${name}! Новый день — новый шанс стать лучше. ${totalTasks} задач${events > 0 ? `, ${events} встреч` : ''} — справимся!${streak > 1 ? ` Стрик: ${streak} дней!` : ''}`,
        strict: `Утро. Время работать. ${totalTasks} задач${events > 0 ? `, ${events} встреч` : ''}. Начинай.`,
        calm: `Доброе утро. День полон возможностей.${totalTasks > 0 ? ` ${totalTasks} задач ждут.` : ''} Спроси — и я помогу.`,
        toxic: `Проснулся, красавчик? У тебя ${totalTasks} дел и ${pendingTasks} ещё не сделаны. Может хотя бы сегодня попытаешься?`,
      },
    };

    const genderKey = gender === 'male' ? 'male' : 'female';
    greeting = greetings[genderKey][style];
  }

  // Afternoon (12-17)
  if (hour >= 12 && hour < 17) {
    greeting = `Добрый день, ${name}!${pendingTasks > 0 ? ` Осталось ${pendingTasks} задач.` : ' Все задачи выполнены!'} Чем помочь?`;
  }

  // Evening (17-22)
  if (hour >= 17 && hour < 22) {
    greeting = `Добрый вечер, ${name}!${pendingTasks > 0 ? ` Ещё ${pendingTasks} задач не закрыты.` : ' Все задачи на сегодня выполнены!'} Как прошёл день?`;
  }

  // Night (22-5)
  if (hour >= 22 || hour < 5) {
    greeting = `Доброй ночи, ${name}. Поздновато, не пора ли отдохнуть?`;
  }

  const suggestions = generateSuggestions(context, '', '');

  return { text: greeting, suggestions };
}
