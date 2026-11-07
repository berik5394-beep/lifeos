import { expenseCategories } from '@/constants';

/**
 * «Разбор твоей жизни» (кнопка «Разбор» в Финансах). Сервер
 * POST /ai/life-analysis считает финансы, сон/настроение из дневника, цели и
 * привычки и просит Claude вывод. Его ответ ({financial, health, life,
 * aiSummary}) никогда не совпадал с тем, что рисует экран, — экран всегда
 * писал «Не удалось загрузить». Здесь — перевод одного в другое.
 */

// ---------- Ответ сервера (packages/server/src/services/life-truth-analyzer.ts) ----------

export interface ServerLifeAnalysis {
  financial: {
    monthlyBurn: number;
    monthlyIncome: number;
    savingsRate: number | null;
    topMoneyDrains: Array<{ category: string; amount: number; percentOfIncome: number }>;
    daysUntilBroke: number | null;
    canAffordApartment: { years: number; currentSavingsRate: number; neededSavingsRate: number } | null;
    costOfLife: { daily: number; monthly: number; yearly: number };
    financialDecisionsToPoverty: string[];
    cashFlowGaps: Array<{ period: string; deficit: number }>;
    wastefulSpending: Array<{ category: string; amount: number; suggestion: string }>;
  };
  health: {
    avgSleepHours: number | null;
    avgMoodScore: number | null;
    avgEnergyScore: number | null;
    exerciseFrequency: string;
    stepsPerDay: number;
    burnoutRisk: 'low' | 'medium' | 'high' | 'critical';
    bodyWarnings: string[];
    mentalHealthFlags: string[];
  };
  life: {
    goalsOnTrack: number;
    goalsBehind: number;
    habitConsistency: number;
    worstHabits: string[];
    productivityTrend: 'improving' | 'stable' | 'declining';
    streakStatus: { current: number; best: number };
    lifeCostPerDay: number;
  };
  aiSummary: string;
}

// ---------- То, что рисует экран ----------

export type Severity = 'good' | 'warning' | 'danger';

export interface MoneyDrain {
  category: string;
  label: string;
  amount: number;
  /** Доля в расходах месяца, 0–100. */
  percent: number;
  color: string;
}

export interface FinancialTruth {
  monthlyBurnRate: number;
  /** null — доходов нет, считать не от чего. */
  savingsRate: number | null;
  topDrains: MoneyDrain[];
  /** null — посчитать нельзя (нет накоплений/дохода). */
  apartmentTimeline: string | null;
  daysUntilBroke: number | null;
  dailyLifeCost: number;
  badDecisions: string[];
  cashFlowGaps: string[];
}

export interface HealthTruth {
  /** null — дневник сна не заполнен. */
  sleepHours: number | null;
  sleepVerdict: string;
  sleepSeverity: Severity;
  /** 0 — шагомера нет, строку не показываем. */
  stepsPerDay: number;
  stepsVerdict: string;
  stepsSeverity: Severity;
  exerciseFrequency: string;
  burnoutRisk: number;
  bodyWarnings: string[];
  mentalHealthFlags: string[];
}

export interface LifeProgress {
  goalsOnTrack: number;
  goalsBehind: number;
  goalsTotal: number;
  habitConsistency: number;
  worstHabits: { name: string }[];
  productivityTrend: 'up' | 'down' | 'flat';
  currentStreak: number;
}

export interface ExitStrategy {
  id: string;
  text: string;
  actionType: 'task' | 'habit';
  actionData: Record<string, string>;
}

export interface LifeAnalysis {
  financial: FinancialTruth;
  health: HealthTruth;
  progress: LifeProgress;
  aiVerdict: string;
  exitStrategies: ExitStrategy[];
  /** Данных почти нет — честно сказать, а не рисовать нули как «правду». */
  sparse: boolean;
}

const BURNOUT: Record<ServerLifeAnalysis['health']['burnoutRisk'], number> = { low: 20, medium: 50, high: 75, critical: 95 };
const TREND: Record<ServerLifeAnalysis['life']['productivityTrend'], LifeProgress['productivityTrend']> = {
  improving: 'up',
  stable: 'flat',
  declining: 'down',
};

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

function categoryInfo(key: string): { label: string; color: string } {
  const c = (expenseCategories as Record<string, { label: string; color: string }>)[key];
  return c ? { label: c.label, color: c.color } : { label: key, color: '#94A3B8' };
}

function sleepOf(h: number | null): { verdict: string; severity: Severity } {
  if (h === null) return { verdict: 'Нет данных — отмечай сон в дневнике', severity: 'warning' };
  if (h < 6) return { verdict: 'Мало сна — организм копит усталость', severity: 'danger' };
  if (h < 7) return { verdict: 'Чуть меньше нормы (7–9 ч)', severity: 'warning' };
  return { verdict: 'В норме', severity: 'good' };
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toLifeAnalysis(s: ServerLifeAnalysis, now: Date = new Date()): LifeAnalysis {
  const f = s.financial;
  const burn = f.monthlyBurn > 0 ? f.monthlyBurn : 0;
  const sleep = sleepOf(s.health.avgSleepHours);
  const steps = s.health.stepsPerDay > 0 ? s.health.stepsPerDay : 0;
  const goalsTotal = s.life.goalsOnTrack + s.life.goalsBehind;
  return {
    financial: {
      monthlyBurnRate: burn,
      savingsRate: f.savingsRate === null ? null : Math.round(f.savingsRate),
      topDrains: f.topMoneyDrains.slice(0, 3).map((d) => ({
        category: d.category,
        ...categoryInfo(d.category),
        amount: d.amount,
        percent: burn > 0 ? Math.min(100, Math.round((d.amount / burn) * 100)) : 0,
      })),
      apartmentTimeline: f.canAffordApartment
        ? `Квартира — примерно через ${Math.round(f.canAffordApartment.years)} лет при нынешних накоплениях`
        : null,
      daysUntilBroke: f.daysUntilBroke,
      dailyLifeCost: f.costOfLife.daily,
      badDecisions: f.financialDecisionsToPoverty,
      cashFlowGaps: f.cashFlowGaps.map((g) => `${g.period}: не хватает ${money(g.deficit)}`),
    },
    health: {
      sleepHours: s.health.avgSleepHours === null ? null : Math.round(s.health.avgSleepHours * 10) / 10,
      sleepVerdict: sleep.verdict,
      sleepSeverity: sleep.severity,
      stepsPerDay: steps,
      stepsVerdict: steps >= 8000 ? 'Двигаешься достаточно' : 'Мало движения',
      stepsSeverity: steps >= 8000 ? 'good' : steps >= 5000 ? 'warning' : 'danger',
      exerciseFrequency: s.health.exerciseFrequency,
      burnoutRisk: BURNOUT[s.health.burnoutRisk] ?? 50,
      bodyWarnings: s.health.bodyWarnings,
      mentalHealthFlags: s.health.mentalHealthFlags,
    },
    progress: {
      goalsOnTrack: s.life.goalsOnTrack,
      goalsBehind: s.life.goalsBehind,
      goalsTotal,
      habitConsistency: Math.round(s.life.habitConsistency),
      worstHabits: s.life.worstHabits.map((name) => ({ name })),
      productivityTrend: TREND[s.life.productivityTrend] ?? 'flat',
      currentStreak: s.life.streakStatus.current,
    },
    aiVerdict: s.aiSummary,
    // Совет сервера «где урезать» → кнопка «Задача» (сразу в план на сегодня).
    exitStrategies: f.wastefulSpending.slice(0, 3).map((w, i) => ({
      id: `cut-${i}-${w.category}`,
      text: w.suggestion,
      actionType: 'task',
      actionData: {
        title: `Сократить: ${categoryInfo(w.category).label.toLowerCase()} (${money(w.amount)} в месяц)`,
        category: 'finance',
        priority: 'medium',
        date: localDate(now),
      },
    })),
    sparse: burn === 0 && f.monthlyIncome === 0 && goalsTotal === 0 && s.life.habitConsistency === 0 && s.health.avgSleepHours === null,
  };
}
