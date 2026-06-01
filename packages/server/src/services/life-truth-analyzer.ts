/**
 * Life Truth Analyzer — brutally honest, data-driven life analysis.
 *
 * Gathers ALL user data (finances, habits, tasks, health, goals, steps)
 * and produces fact-based insights with no sugarcoating.
 */

import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinancialTruth {
  monthlyBurn: number;
  monthlyIncome: number;
  savingsRate: number;
  topMoneyDrains: Array<{ category: string; amount: number; percentOfIncome: number }>;
  daysUntilBroke: number | null;
  canAffordApartment: {
    years: number;
    currentSavingsRate: number;
    neededSavingsRate: number;
  } | null;
  costOfLife: { daily: number; monthly: number; yearly: number };
  financialDecisionsToPoverty: string[];
  cashFlowGaps: Array<{ period: string; deficit: number }>;
  wastefulSpending: Array<{ category: string; amount: number; suggestion: string }>;
}

export interface HealthTruth {
  avgSleepHours: number | null;
  avgMoodScore: number | null;
  avgEnergyScore: number | null;
  exerciseFrequency: string;
  stepsPerDay: number;
  burnoutRisk: 'low' | 'medium' | 'high' | 'critical';
  bodyWarnings: string[];
  mentalHealthFlags: string[];
}

export interface LifeTruth {
  goalsOnTrack: number;
  goalsBehind: number;
  habitConsistency: number;
  worstHabits: string[];
  productivityTrend: 'improving' | 'stable' | 'declining';
  streakStatus: { current: number; best: number };
  lifeCostPerDay: number;
}

export interface LifeAnalysisResult {
  financial: FinancialTruth;
  health: HealthTruth;
  life: LifeTruth;
  aiSummary: string;
}

interface RawUserData {
  userName: string;
  currency: string;
  expenses3m: Array<{ category: string; amount: number; date: Date }>;
  incomes3m: Array<{ source: string; amount: number; date: Date }>;
  budgetLimits: Array<{ category: string; monthlyLimit: number; month: number; year: number }>;
  habits: Array<{ id: string; name: string; category: string }>;
  habitLogs30d: Array<{ habitId: string; date: Date; completed: boolean }>;
  habitLogs90d: Array<{ habitId: string; date: Date; completed: boolean }>;
  tasks30d: Array<{ completed: boolean; date: Date; category: string }>;
  tasks90d: Array<{ completed: boolean; date: Date }>;
  stepLogs30d: Array<{ steps: number; date: Date }>;
  journalEntries30d: Array<{ mood: number | null; energy: number | null; sleepHours: number | null; date: Date }>;
  yearlyGoals: Array<{ area: string; goalText: string; progress: number }>;
  weeklyGoals4w: Array<{ goalText: string; completed: boolean; weekStart: Date }>;
  pet: { health: number; happiness: number; level: number; streak: number; isAlive: boolean } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APARTMENT_PRICE_ALMATY_AVG = 35_000_000; // ₸ — средняя стоимость в Алматы

const WASTEFUL_CATEGORIES: Record<string, string> = {
  entertainment: 'Развлечения можно сократить — замени платные на бесплатные (парки, книги).',
  clothing: 'Одежда — покупай только по необходимости, не по настроению.',
  food: 'Еда — готовь дома, мил-преп экономит до 40% бюджета на еду.',
  other: 'Категория "Прочее" — разбери что туда попадает, скорее всего там скрытые утечки.',
};

// ---------------------------------------------------------------------------
// Data Gathering
// ---------------------------------------------------------------------------

async function gatherAllUserData(userId: string): Promise<RawUserData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, currency: true },
  });
  if (!user) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const daysAgo = (n: number): Date => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };

  const monthsAgo = (n: number): Date => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - n);
    d.setDate(1);
    return d;
  };

  const start3m = monthsAgo(3);
  const start30d = daysAgo(30);
  const start90d = daysAgo(90);

  // 4 weeks of weekly goals
  const start4w = daysAgo(28);

  const [
    expenses3m,
    incomes3m,
    budgetLimits,
    habits,
    habitLogs30d,
    habitLogs90d,
    tasks30d,
    tasks90d,
    stepLogs30d,
    journalEntries30d,
    yearlyGoals,
    weeklyGoals4w,
    pet,
  ] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, date: { gte: start3m } },
      select: { category: true, amount: true, date: true },
      orderBy: { date: 'desc' },
    }),
    prisma.income.findMany({
      where: { userId, date: { gte: start3m } },
      select: { source: true, amount: true, date: true },
      orderBy: { date: 'desc' },
    }),
    prisma.budgetLimit.findMany({
      where: { userId },
      select: { category: true, monthlyLimit: true, month: true, year: true },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true, category: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: { gte: start30d }, completed: true },
      select: { habitId: true, date: true, completed: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: { gte: start90d }, completed: true },
      select: { habitId: true, date: true, completed: true },
    }),
    prisma.task.findMany({
      where: { userId, date: { gte: start30d } },
      select: { completed: true, date: true, category: true },
    }),
    prisma.task.findMany({
      where: { userId, date: { gte: start90d } },
      select: { completed: true, date: true },
    }),
    prisma.stepLog.findMany({
      where: { userId, date: { gte: start30d } },
      select: { steps: true, date: true },
    }),
    prisma.journalEntry.findMany({
      where: { userId, date: { gte: start30d } },
      select: { mood: true, energy: true, sleepHours: true, date: true },
    }),
    prisma.yearlyGoal.findMany({
      where: { userId, year: now.getFullYear() },
      select: { area: true, goalText: true, progress: true },
    }),
    prisma.weeklyGoal.findMany({
      where: { userId, weekStart: { gte: start4w } },
      select: { goalText: true, completed: true, weekStart: true },
    }),
    prisma.pet.findUnique({
      where: { userId },
      select: { health: true, happiness: true, level: true, streak: true, isAlive: true },
    }),
  ]);

  return {
    userName: user.name,
    currency: user.currency,
    expenses3m,
    incomes3m,
    budgetLimits,
    habits,
    habitLogs30d,
    habitLogs90d,
    tasks30d,
    tasks90d,
    stepLogs30d,
    journalEntries30d,
    yearlyGoals,
    weeklyGoals4w,
    pet,
  };
}

// ---------------------------------------------------------------------------
// Financial Analysis
// ---------------------------------------------------------------------------

function analyzeFinances(data: RawUserData): FinancialTruth {
  const { expenses3m, incomes3m, budgetLimits } = data;

  // Monthly aggregates
  const monthlyExpenses = new Map<string, number>();
  const categoryTotals = new Map<string, number>();

  for (const e of expenses3m) {
    const key = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`;
    monthlyExpenses.set(key, (monthlyExpenses.get(key) ?? 0) + e.amount);
    categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + e.amount);
  }

  const monthlyIncomes = new Map<string, number>();
  for (const i of incomes3m) {
    const key = `${i.date.getFullYear()}-${String(i.date.getMonth() + 1).padStart(2, '0')}`;
    monthlyIncomes.set(key, (monthlyIncomes.get(key) ?? 0) + i.amount);
  }

  const expenseMonths = [...monthlyExpenses.values()];
  const incomeMonths = [...monthlyIncomes.values()];

  const monthCount = Math.max(expenseMonths.length, 1);
  const totalExpenses = expenseMonths.reduce((s, v) => s + v, 0);
  const totalIncomes = incomeMonths.reduce((s, v) => s + v, 0);

  const monthlyBurn = Math.round(totalExpenses / monthCount);
  const monthlyIncome = Math.round(totalIncomes / Math.max(incomeMonths.length, 1));
  const savingsRate = monthlyIncome > 0
    ? Math.round(((monthlyIncome - monthlyBurn) / monthlyIncome) * 100)
    : -100;

  // Top money drains
  const topMoneyDrains = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount / monthCount),
      percentOfIncome: monthlyIncome > 0
        ? Math.round(((amount / monthCount) / monthlyIncome) * 100)
        : 0,
    }));

  // Days until broke
  const monthlySavings = monthlyIncome - monthlyBurn;
  const daysUntilBroke = monthlySavings < 0
    ? Math.round(Math.abs(30 * monthlyIncome / monthlyBurn))
    : null;

  // Can afford apartment
  const canAffordApartment = monthlyIncome > 0
    ? {
        years: monthlySavings > 0
          ? Math.round((APARTMENT_PRICE_ALMATY_AVG / (monthlySavings * 12)) * 10) / 10
          : Infinity,
        currentSavingsRate: savingsRate,
        neededSavingsRate: Math.round(
          (APARTMENT_PRICE_ALMATY_AVG / (10 * 12 * monthlyIncome)) * 100,
        ),
      }
    : null;

  // Cost of life
  const daily = Math.round(monthlyBurn / 30);
  const costOfLife = { daily, monthly: monthlyBurn, yearly: monthlyBurn * 12 };

  // Financial bad patterns
  const financialDecisionsToPoverty: string[] = [];

  if (savingsRate < 0) {
    financialDecisionsToPoverty.push(
      `Тратишь больше, чем зарабатываешь: дефицит ${Math.abs(monthlySavings).toLocaleString()}₸/мес.`,
    );
  } else if (savingsRate < 10) {
    financialDecisionsToPoverty.push(
      `Откладываешь менее 10% дохода — это путь к нулевой подушке.`,
    );
  }

  for (const drain of topMoneyDrains) {
    if (drain.percentOfIncome > 30 && drain.category !== 'home') {
      financialDecisionsToPoverty.push(
        `${drain.category}: ${drain.percentOfIncome}% дохода — слишком много на одну категорию.`,
      );
    }
  }

  // Budget violations
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentBudgets = budgetLimits.filter(
    (b) => b.month === currentMonth && b.year === currentYear,
  );

  for (const budget of currentBudgets) {
    const spent = expenses3m
      .filter(
        (e) =>
          e.category === budget.category &&
          e.date.getMonth() + 1 === currentMonth &&
          e.date.getFullYear() === currentYear,
      )
      .reduce((s, e) => s + e.amount, 0);

    if (spent > budget.monthlyLimit) {
      financialDecisionsToPoverty.push(
        `Лимит "${budget.category}" превышен: ${spent.toLocaleString()}₸ из ${budget.monthlyLimit.toLocaleString()}₸.`,
      );
    }
  }

  // Cash flow gaps — months where spending exceeded income
  const allMonthKeys = new Set([...monthlyExpenses.keys(), ...monthlyIncomes.keys()]);
  const cashFlowGaps: Array<{ period: string; deficit: number }> = [];
  for (const key of allMonthKeys) {
    const exp = monthlyExpenses.get(key) ?? 0;
    const inc = monthlyIncomes.get(key) ?? 0;
    if (exp > inc) {
      cashFlowGaps.push({ period: key, deficit: Math.round(exp - inc) });
    }
  }

  // Wasteful spending
  const wastefulSpending: Array<{ category: string; amount: number; suggestion: string }> = [];
  for (const [category, suggestion] of Object.entries(WASTEFUL_CATEGORIES)) {
    const monthlyAmount = Math.round((categoryTotals.get(category) ?? 0) / monthCount);
    if (monthlyAmount > 0 && monthlyIncome > 0 && monthlyAmount / monthlyIncome > 0.15) {
      wastefulSpending.push({ category, amount: monthlyAmount, suggestion });
    }
  }

  return {
    monthlyBurn,
    monthlyIncome,
    savingsRate,
    topMoneyDrains,
    daysUntilBroke,
    canAffordApartment,
    costOfLife,
    financialDecisionsToPoverty,
    cashFlowGaps,
    wastefulSpending,
  };
}

// ---------------------------------------------------------------------------
// Health Analysis
// ---------------------------------------------------------------------------

function analyzeHealth(data: RawUserData): HealthTruth {
  const { journalEntries30d, stepLogs30d, habitLogs30d, habits } = data;

  // Sleep
  const sleepEntries = journalEntries30d.filter((j) => j.sleepHours != null);
  const avgSleepHours = sleepEntries.length > 0
    ? Math.round((sleepEntries.reduce((s, j) => s + (j.sleepHours ?? 0), 0) / sleepEntries.length) * 10) / 10
    : null;

  // Mood
  const moodEntries = journalEntries30d.filter((j) => j.mood != null);
  const avgMoodScore = moodEntries.length > 0
    ? Math.round((moodEntries.reduce((s, j) => s + (j.mood ?? 0), 0) / moodEntries.length) * 10) / 10
    : null;

  // Energy
  const energyEntries = journalEntries30d.filter((j) => j.energy != null);
  const avgEnergyScore = energyEntries.length > 0
    ? Math.round((energyEntries.reduce((s, j) => s + (j.energy ?? 0), 0) / energyEntries.length) * 10) / 10
    : null;

  // Exercise frequency — count health-category habit completions
  const healthHabitIds = new Set(habits.filter((h) => h.category === 'health').map((h) => h.id));
  const exerciseDays = new Set(
    habitLogs30d
      .filter((l) => healthHabitIds.has(l.habitId))
      .map((l) => l.date.toISOString().split('T')[0]),
  );
  const exercisePerWeek = Math.round((exerciseDays.size / 30) * 7 * 10) / 10;
  const exerciseFrequency = exercisePerWeek >= 1
    ? `${exercisePerWeek} раз в неделю`
    : exerciseDays.size > 0
      ? `${exerciseDays.size} раз за 30 дней`
      : 'Нет данных о тренировках';

  // Steps
  const stepsPerDay = stepLogs30d.length > 0
    ? Math.round(stepLogs30d.reduce((s, l) => s + l.steps, 0) / stepLogs30d.length)
    : 0;

  // Burnout risk
  let burnoutScore = 0;
  if (avgSleepHours != null && avgSleepHours < 6) burnoutScore += 3;
  else if (avgSleepHours != null && avgSleepHours < 7) burnoutScore += 1;
  if (avgEnergyScore != null && avgEnergyScore <= 3) burnoutScore += 2;
  if (avgMoodScore != null && avgMoodScore <= 3) burnoutScore += 2;
  if (exercisePerWeek < 2) burnoutScore += 1;
  if (stepsPerDay > 0 && stepsPerDay < 3000) burnoutScore += 1;

  const burnoutRisk: HealthTruth['burnoutRisk'] =
    burnoutScore >= 6 ? 'critical' :
    burnoutScore >= 4 ? 'high' :
    burnoutScore >= 2 ? 'medium' : 'low';

  // Body warnings
  const bodyWarnings: string[] = [];
  if (avgSleepHours != null && avgSleepHours < 6) {
    bodyWarnings.push(`Сон ${avgSleepHours}ч в среднем — это путь к выгоранию и хроническим болезням.`);
  } else if (avgSleepHours != null && avgSleepHours < 7) {
    bodyWarnings.push(`Сон ${avgSleepHours}ч — ниже рекомендуемых 7-9 часов.`);
  }
  if (stepsPerDay > 0 && stepsPerDay < 5000) {
    bodyWarnings.push(`${stepsPerDay} шагов/день — сидячий образ жизни. Минимум 7000 для здоровья.`);
  }
  if (exercisePerWeek < 2) {
    bodyWarnings.push('Тренировки реже 2 раз в неделю — мышцы атрофируются, метаболизм замедляется.');
  }

  // Mental health flags — look at mood trends
  const mentalHealthFlags: string[] = [];
  if (avgMoodScore != null && avgMoodScore <= 3) {
    mentalHealthFlags.push(`Средний уровень настроения ${avgMoodScore}/10 — тревожно низкий показатель.`);
  }
  if (avgEnergyScore != null && avgEnergyScore <= 3) {
    mentalHealthFlags.push(`Средняя энергия ${avgEnergyScore}/10 — хроническая усталость.`);
  }

  // Check declining mood trend
  if (moodEntries.length >= 10) {
    const firstHalf = moodEntries.slice(0, Math.floor(moodEntries.length / 2));
    const secondHalf = moodEntries.slice(Math.floor(moodEntries.length / 2));
    const avgFirst = firstHalf.reduce((s, j) => s + (j.mood ?? 0), 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, j) => s + (j.mood ?? 0), 0) / secondHalf.length;
    if (avgSecond < avgFirst - 1) {
      mentalHealthFlags.push('Настроение падает — за последние 2 недели заметный спад.');
    }
  }

  if (journalEntries30d.length < 5) {
    mentalHealthFlags.push('Дневник почти не заполняется — ты избегаешь рефлексии.');
  }

  return {
    avgSleepHours,
    avgMoodScore,
    avgEnergyScore,
    exerciseFrequency,
    stepsPerDay,
    burnoutRisk,
    bodyWarnings,
    mentalHealthFlags,
  };
}

// ---------------------------------------------------------------------------
// Life Progress Analysis
// ---------------------------------------------------------------------------

function analyzeLifeProgress(data: RawUserData): LifeTruth {
  const { yearlyGoals, habits, habitLogs30d, habitLogs90d, tasks30d, tasks90d, expenses3m, pet } = data;

  // Goals
  const now = new Date();
  const monthOfYear = now.getMonth() + 1;
  const expectedProgress = Math.round((monthOfYear / 12) * 100);

  let goalsOnTrack = 0;
  let goalsBehind = 0;
  for (const g of yearlyGoals) {
    if (g.progress >= expectedProgress * 0.8) {
      goalsOnTrack++;
    } else {
      goalsBehind++;
    }
  }

  // Habit consistency — last 30 days
  const totalPossible = habits.length * 30;
  const totalCompleted = habitLogs30d.length;
  const habitConsistency = totalPossible > 0
    ? Math.round((totalCompleted / totalPossible) * 100)
    : 0;

  // Worst habits
  const habitCompletionMap = new Map<string, number>();
  for (const h of habits) {
    habitCompletionMap.set(h.id, 0);
  }
  for (const log of habitLogs30d) {
    habitCompletionMap.set(log.habitId, (habitCompletionMap.get(log.habitId) ?? 0) + 1);
  }

  const worstHabits = habits
    .map((h) => ({ name: h.name, rate: (habitCompletionMap.get(h.id) ?? 0) / 30 }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .filter((h) => h.rate < 0.5)
    .map((h) => `${h.name} (${Math.round(h.rate * 100)}%)`);

  // Productivity trend — compare last 30d vs previous 30d task completion
  const now30 = new Date();
  now30.setDate(now30.getDate() - 30);
  const now60 = new Date();
  now60.setDate(now60.getDate() - 60);

  const recentTasks = tasks30d;
  const olderTasks = tasks90d.filter((t) => t.date < now30 && t.date >= now60);

  const recentRate = recentTasks.length > 0
    ? recentTasks.filter((t) => t.completed).length / recentTasks.length
    : 0;
  const olderRate = olderTasks.length > 0
    ? olderTasks.filter((t) => t.completed).length / olderTasks.length
    : 0;

  let productivityTrend: LifeTruth['productivityTrend'];
  if (recentRate > olderRate + 0.1) {
    productivityTrend = 'improving';
  } else if (recentRate < olderRate - 0.1) {
    productivityTrend = 'declining';
  } else {
    productivityTrend = 'stable';
  }

  // Streak
  const currentStreak = pet?.streak ?? 0;
  // Best streak is not stored; use current as proxy
  const bestStreak = currentStreak;

  // Life cost per day
  const totalExpenses3m = expenses3m.reduce((s, e) => s + e.amount, 0);
  const lifeCostPerDay = Math.round(totalExpenses3m / 90);

  return {
    goalsOnTrack,
    goalsBehind,
    habitConsistency,
    worstHabits,
    productivityTrend,
    streakStatus: { current: currentStreak, best: bestStreak },
    lifeCostPerDay,
  };
}

// ---------------------------------------------------------------------------
// AI Prompt Builder
// ---------------------------------------------------------------------------

function generateLifeTruthPrompt(
  data: RawUserData,
  financial: FinancialTruth,
  health: HealthTruth,
  life: LifeTruth,
): string {
  const lines: string[] = [];

  lines.push(`Ты — Life Truth Analyzer, безжалостно честный AI-аналитик жизни пользователя ${data.userName}.`);
  lines.push(`Дата анализа: ${new Date().toISOString().split('T')[0]}.`);
  lines.push(`Валюта: ${data.currency || '₸'}.`);
  lines.push('');
  lines.push('ФИНАНСОВАЯ ПРАВДА:');
  lines.push(`- Средний расход/мес: ${financial.monthlyBurn.toLocaleString()}₸`);
  lines.push(`- Средний доход/мес: ${financial.monthlyIncome.toLocaleString()}₸`);
  lines.push(`- Норма накоплений: ${financial.savingsRate}%`);
  lines.push(`- Стоимость жизни: ${financial.costOfLife.daily.toLocaleString()}₸/день, ${financial.costOfLife.yearly.toLocaleString()}₸/год`);

  if (financial.daysUntilBroke != null) {
    lines.push(`- ВНИМАНИЕ: при текущем темпе, денег хватит примерно на ${financial.daysUntilBroke} дней.`);
  }

  if (financial.canAffordApartment) {
    if (financial.canAffordApartment.years === Infinity) {
      lines.push('- Квартира: при текущих накоплениях — НИКОГДА. Накопления нулевые или отрицательные.');
    } else {
      lines.push(`- Квартира (35 млн ₸): при текущих накоплениях — через ${financial.canAffordApartment.years} лет.`);
    }
  }

  if (financial.topMoneyDrains.length > 0) {
    lines.push('- Главные утечки денег:');
    for (const d of financial.topMoneyDrains) {
      lines.push(`  * ${d.category}: ${d.amount.toLocaleString()}₸/мес (${d.percentOfIncome}% дохода)`);
    }
  }

  if (financial.financialDecisionsToPoverty.length > 0) {
    lines.push('- Путь к бедности:');
    for (const f of financial.financialDecisionsToPoverty) {
      lines.push(`  * ${f}`);
    }
  }

  if (financial.cashFlowGaps.length > 0) {
    lines.push('- Месяцы с дефицитом:');
    for (const g of financial.cashFlowGaps) {
      lines.push(`  * ${g.period}: дефицит ${g.deficit.toLocaleString()}₸`);
    }
  }

  if (financial.wastefulSpending.length > 0) {
    lines.push('- Бесполезные траты:');
    for (const w of financial.wastefulSpending) {
      lines.push(`  * ${w.category}: ${w.amount.toLocaleString()}₸/мес — ${w.suggestion}`);
    }
  }

  lines.push('');
  lines.push('ЗДОРОВЬЕ:');
  if (health.avgSleepHours != null) lines.push(`- Сон: ${health.avgSleepHours}ч в среднем`);
  if (health.avgMoodScore != null) lines.push(`- Настроение: ${health.avgMoodScore}/10`);
  if (health.avgEnergyScore != null) lines.push(`- Энергия: ${health.avgEnergyScore}/10`);
  lines.push(`- Тренировки: ${health.exerciseFrequency}`);
  if (health.stepsPerDay > 0) lines.push(`- Шаги: ${health.stepsPerDay}/день`);
  lines.push(`- Риск выгорания: ${health.burnoutRisk}`);

  if (health.bodyWarnings.length > 0) {
    lines.push('- Предупреждения:');
    for (const w of health.bodyWarnings) lines.push(`  * ${w}`);
  }
  if (health.mentalHealthFlags.length > 0) {
    lines.push('- Ментальное здоровье:');
    for (const f of health.mentalHealthFlags) lines.push(`  * ${f}`);
  }

  lines.push('');
  lines.push('ПРОГРЕСС ЖИЗНИ:');
  lines.push(`- Годовые цели: ${life.goalsOnTrack} по плану, ${life.goalsBehind} отстают`);
  lines.push(`- Консистентность привычек: ${life.habitConsistency}%`);
  if (life.worstHabits.length > 0) {
    lines.push(`- Худшие привычки: ${life.worstHabits.join(', ')}`);
  }
  lines.push(`- Тренд продуктивности: ${life.productivityTrend === 'improving' ? 'растёт' : life.productivityTrend === 'declining' ? 'падает' : 'стабильный'}`);
  lines.push(`- Серия: ${life.streakStatus.current} дней`);
  lines.push(`- Стоимость жизни: ${life.lifeCostPerDay.toLocaleString()}₸/день`);

  if (data.pet) {
    lines.push('');
    lines.push('ПИТОМЕЦ:');
    lines.push(`- Здоровье: ${data.pet.health}%, Счастье: ${data.pet.happiness}%, Уровень: ${data.pet.level}`);
    lines.push(`- Жив: ${data.pet.isAlive ? 'да' : 'НЕТ — питомец умер от игнора'}`);
  }

  lines.push('');
  lines.push('ИНСТРУКЦИЯ:');
  lines.push('Дай жёсткий, 100% честный анализ жизни пользователя на основе этих данных.');
  lines.push('Правила:');
  lines.push('1. НЕ приукрашивай. Если дела плохи — скажи прямо.');
  lines.push('2. Используй КОНКРЕТНЫЕ цифры из данных выше.');
  lines.push('3. Укажи паттерны, ведущие к бедности/выгоранию/проблемам со здоровьем.');
  lines.push('4. ВСЕГДА давай конкретные стратегии выхода (не абстрактные советы).');
  lines.push('5. Валюта — ₸ (тенге). Все суммы в тенге.');
  lines.push('6. Пиши на русском языке.');
  lines.push('7. Формат: сначала жёсткий диагноз (3-4 абзаца), потом план действий (5-7 конкретных шагов).');
  lines.push('8. Обращайся на "ты" по имени.');
  lines.push(`9. Имя пользователя: ${data.userName}.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Quick Daily Prompt (shorter version for dashboard)
// ---------------------------------------------------------------------------

function generateQuickTruthPrompt(
  data: RawUserData,
  financial: FinancialTruth,
  health: HealthTruth,
  life: LifeTruth,
): string {
  const lines: string[] = [];
  lines.push(`Ты — краткий AI-аналитик жизни ${data.userName}. Дай ОЧЕНЬ короткий (3-5 предложений) жёсткий вердикт на основе данных.`);
  lines.push(`Расход: ${financial.monthlyBurn.toLocaleString()}₸/мес, Доход: ${financial.monthlyIncome.toLocaleString()}₸/мес, Накопления: ${financial.savingsRate}%.`);
  lines.push(`Привычки: ${life.habitConsistency}%, Серия: ${life.streakStatus.current} дней.`);
  if (health.burnoutRisk !== 'low') lines.push(`Риск выгорания: ${health.burnoutRisk}.`);
  if (life.goalsBehind > 0) lines.push(`${life.goalsBehind} целей отстают от графика.`);
  lines.push('Ответь на русском, коротко и жёстко. Один главный вывод + одно конкретное действие на сегодня.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Claude API Call
// ---------------------------------------------------------------------------

async function callClaude(systemPrompt: string): Promise<string> {
  // FIX (P6-safety 2026-05-28): CLAUDE_API_KEY (см. .env.example).
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return 'AI-анализ недоступен: не настроен CLAUDE_API_KEY.';
  }

  const client = createAnthropic(apiKey);

  try {
    const response = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 2048,
      messages: [
        { role: 'user', content: 'Проанализируй мою жизнь. Будь жёстким и честным.' },
      ],
      system: systemPrompt,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : 'Не удалось получить ответ от AI.';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Life Truth AI call failed:', message);
    return 'AI-анализ временно недоступен. Попробуйте позже.';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeLife(userId: string): Promise<LifeAnalysisResult> {
  const data = await gatherAllUserData(userId);
  if (!data) {
    throw new Error('Пользователь не найден');
  }

  const financial = analyzeFinances(data);
  const health = analyzeHealth(data);
  const life = analyzeLifeProgress(data);

  const prompt = generateLifeTruthPrompt(data, financial, health, life);
  const aiSummary = await callClaude(prompt);

  return { financial, health, life, aiSummary };
}

export async function analyzeFinancialTruth(userId: string): Promise<FinancialTruth> {
  const data = await gatherAllUserData(userId);
  if (!data) throw new Error('Пользователь не найден');
  return analyzeFinances(data);
}

export async function analyzeHealthTruth(userId: string): Promise<HealthTruth> {
  const data = await gatherAllUserData(userId);
  if (!data) throw new Error('Пользователь не найден');
  return analyzeHealth(data);
}

export async function analyzeQuickTruth(userId: string): Promise<{
  financial: FinancialTruth;
  health: HealthTruth;
  life: LifeTruth;
  aiSummary: string;
}> {
  const data = await gatherAllUserData(userId);
  if (!data) throw new Error('Пользователь не найден');

  const financial = analyzeFinances(data);
  const health = analyzeHealth(data);
  const life = analyzeLifeProgress(data);

  const prompt = generateQuickTruthPrompt(data, financial, health, life);
  const aiSummary = await callClaude(prompt);

  return { financial, health, life, aiSummary };
}
