/**
 * Разбор цели при постановке — адаптер (факты из БД → чистое ядро goal-intake.ts).
 * READ-ONLY: ничего не пишет (запись в чат — на стороне вызывающего роута).
 * Best-effort: общий таймаут, любой сбой → null, цель всё равно записана.
 */
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { withTimeout } from '../lib/with-timeout.js';
import { isV2GoalIntakeEnabled } from '../lib/feature-flags.js';
import { buildGoalIntake, buildShortGoalIntake, MONEY_WINDOW_MONTHS, type GoalIntakeFacts } from './goal-intake.js';
import { isMoneyGoal } from './goal-pace.js';
import { gatherWeekLoad } from './week-load.js';
import { findUpcomingSlot } from './goal-slot.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import type { PortfolioGoal } from './savings-pace.js';

/** Сколько ждём разбор целиком (ИИ-оценка времени — самая долгая часть). */
export const GOAL_INTAKE_BUDGET_MS = 2500;
const FIN_RE = /financ|финанс/i;

/**
 * Минуты в неделю на ГОДОВУЮ цель (estimateWeeklyGoalMinutes спрашивает про
 * недельную — для «24 книги за год» дал бы неделю на все книги). Сбой / нет
 * ключа → null: строку времени не показываем, а не подставляем «2 ч».
 */
export type GoalHorizon = 'year' | 'month' | 'week';
const HORIZON_TEXT: Record<GoalHorizon, string> = {
  year: 'на год (или к сроку)',
  month: 'на этот месяц',
  week: 'на эту неделю',
};

export async function estimateYearlyGoalWeeklyMinutes(goalText: string, horizon: GoalHorizon = 'year'): Promise<number | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 16,
      system:
        `Человек поставил цель ${HORIZON_TEXT[horizon]}. Оцени, сколько МИНУТ в НЕДЕЛЮ ` +
        'ему нужно регулярно уделять ей, чтобы успеть. Если цель не про затраты ' +
        'времени — верни 0. Верни ТОЛЬКО целое число минут, без слов.',
      messages: [{ role: 'user', content: `Цель: «${goalText}»` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? parseYearlyGoalMinutes(block.text) : null;
  } catch {
    return null;
  }
}

/**
 * Минуты из ответа модели. Нет числа → null (НЕ дефолт «2 ч», как у недельной
 * оценки: показали бы цифру не из модели и не из БД). 0 → 0 (цель не про время).
 * Сверху кламп 1200 (20 ч/нед), снизу — нет: «5 мин» и есть 5 мин.
 */
export function parseYearlyGoalMinutes(text: string): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 1200);
}

/** Слова-«наполнители» в названиях привычек — не корень темы. */
const FILLER = new Set(['минут', 'минуты', 'минута', 'мин', 'раз', 'раза', 'день', 'дня', 'утром', 'вечером', 'перед', 'после', 'каждый', 'каждое']);
/** Глагольные приставки: «прочитать» → «читать», «выпить» → «пить». */
const PREFIXES = ['пере', 'про', 'при', 'вы', 'за', 'на', 'по', 'до', 'от', 'об'];

/** Слова ≥3 букв в нижнем регистре. */
function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-zа-яё]{3,}/g) ?? []).filter(Boolean);
}

/**
 * Привычка «по теме» цели: корень слова привычки (4 буквы, короткие «бег»
 * целиком) — начало слова цели или его же без приставки. Слова-наполнители
 * («минут», «раз»…) не в счёт. Только непривязанные и активные. Нет
 * совпадения → null (не предлагаем случайную привычку той же категории).
 */
export function pickLinkableHabit(goalText: string, habits: Array<{ name: string }>): string | null {
  // Слово цели и оно же без приставки: корень ищем только в НАЧАЛЕ слова
  // (внутри слова давало «пить» ⊂ «купить», «мину» ⊂ «минус»).
  const gw = words(goalText).flatMap((g) => [
    g,
    ...PREFIXES.filter((p) => g.startsWith(p) && g.length - p.length >= 3).map((p) => g.slice(p.length)),
  ]);
  for (const h of habits) {
    for (const hw of words(h.name).filter((w) => !FILLER.has(w))) {
      const root = hw.length >= 4 ? hw.slice(0, 4) : hw;
      const hit = gw.some((g) => g.startsWith(root));
      if (hit) return h.name;
    }
  }
  return null;
}

async function moneyFacts(userId: string, goalId: string, year: number, now: Date): Promise<GoalIntakeFacts['money']> {
  const since = new Date(now.getTime() - MONEY_WINDOW_MONTHS * 30 * 86_400_000);
  const [inc, exp, others] = await Promise.all([
    prisma.income.aggregate({ where: { userId, date: { gte: since } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { userId, date: { gte: since } }, _sum: { amount: true } }),
    prisma.yearlyGoal.findMany({
      where: { userId, year, id: { not: goalId }, target: { not: null } },
      select: { goalText: true, area: true, target: true, targetDate: true, createdAt: true },
    }),
  ]);
  // Накоплено по каждой другой фин-цели — как у коуча (доход − расход с её даты).
  const otherGoals: PortfolioGoal[] = await Promise.all(
    others
      .filter((g) => FIN_RE.test(g.area))
      .map(async (g) => {
        const c = g.createdAt;
        const from = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
        const [i, e] = await Promise.all([
          prisma.income.aggregate({ where: { userId, date: { gte: from } }, _sum: { amount: true } }),
          prisma.expense.aggregate({ where: { userId, date: { gte: from } }, _sum: { amount: true } }),
        ]);
        return {
          text: g.goalText,
          target: g.target as number,
          targetDate: g.targetDate ?? new Date(Date.UTC(year, 11, 31, 23, 59)),
          saved: (i._sum.amount ?? 0) - (e._sum.amount ?? 0),
        };
      }),
  );
  return {
    monthlyIncome: (inc._sum.amount ?? 0) / MONEY_WINDOW_MONTHS,
    monthlyBurn: (exp._sum.amount ?? 0) / MONEY_WINDOW_MONTHS,
    otherGoals,
  };
}

async function gather(userId: string, goalId: string, now: Date): Promise<GoalIntakeFacts | null> {
  const goal = await prisma.yearlyGoal.findFirst({
    where: { id: goalId, userId },
    select: { goalText: true, area: true, target: true, targetDate: true, year: true },
  });
  if (!goal) return null;
  // Цель за прошедший год — не постановка, разбирать нечего.
  if (goal.year < now.getFullYear()) return null;
  const isMoney = isMoneyGoal(goal.area, goal.target);

  const moodP = getEmotionalMemory()
    .detectMoodShift(userId)
    .then((m) => !!m?.shifted && m.direction === 'down')
    .catch(() => false);

  if (isMoney) {
    const [money, moodDown] = await Promise.all([moneyFacts(userId, goalId, goal.year, now), moodP]);
    return {
      goal: { text: goal.goalText, area: goal.area, target: goal.target, targetDate: goal.targetDate, year: goal.year },
      money,
      time: null,
      slot: null,
      linkableHabit: null,
      moodDown,
      now,
    };
  }

  const [minutes, week, slot, habits, moodDown] = await Promise.all([
    estimateYearlyGoalWeeklyMinutes(goal.goalText),
    gatherWeekLoad(userId, now).catch(() => null),
    findUpcomingSlot(userId, now, 45),
    prisma.habit.findMany({
      where: { userId, active: true, goalId: null },
      select: { name: true },
      orderBy: { order: 'asc' },
      take: 50,
    }),
    moodP,
  ]);
  return {
    goal: { text: goal.goalText, area: goal.area, target: goal.target, targetDate: goal.targetDate, year: goal.year },
    money: null,
    time:
      minutes && minutes > 0 && week
        ? {
            goalMinutesPerWeek: minutes,
            weekCapacity: week.capacity,
            weekDemand: week.items.reduce((s, i) => s + i.demand, 0),
          }
        : null,
    slot,
    linkableHabit: pickLinkableHabit(goal.goalText, habits),
    moodDown,
    now,
  };
}

/**
 * Разбор только что поставленной годовой цели (строки + вопрос) или null:
 * флаг выкл. / цели нет / не уложились в бюджет / сбой.
 */
export async function maybeGoalIntake(userId: string, goalId: string, now: Date = new Date()): Promise<string | null> {
  if (!isV2GoalIntakeEnabled(userId)) return null;
  const facts = await withTimeout(
    gather(userId, goalId, now).catch((err) => {
      console.warn('[goal-intake] gather failed:', err);
      return null;
    }),
    GOAL_INTAKE_BUDGET_MS,
    null,
  );
  if (!facts) return null;
  try {
    return buildGoalIntake(facts);
  } catch (err) {
    // Цель уже записана — сбой разбора не должен превращать ответ в «не получилось».
    console.warn('[goal-intake] build failed:', err);
    return null;
  }
}

/**
 * Разбор цели месяца/недели (тот же флаг FEATURE_V2_GOAL_INTAKE): время в
 * неделю vs свободное до конца недели, привычка по корню, ближайшее окно.
 * READ-ONLY, тот же бюджет, сбой → null (цель уже записана).
 */
export async function maybeShortGoalIntake(
  userId: string,
  goal: { goalText: string; horizon: 'month' | 'week' },
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2GoalIntakeEnabled(userId)) return null;
  const run = async (): Promise<string | null> => {
    const moodP = getEmotionalMemory()
      .detectMoodShift(userId)
      .then((m) => !!m?.shifted && m.direction === 'down')
      .catch(() => false);
    const [minutes, week, slot, habits, moodDown] = await Promise.all([
      estimateYearlyGoalWeeklyMinutes(goal.goalText, goal.horizon),
      gatherWeekLoad(userId, now).catch(() => null),
      findUpcomingSlot(userId, now, 45),
      prisma.habit.findMany({
        where: { userId, active: true, goalId: null },
        select: { name: true },
        orderBy: { order: 'asc' },
        take: 50,
      }),
      moodP,
    ]);
    return buildShortGoalIntake({
      time:
        minutes && minutes > 0 && week
          ? { goalMinutesPerWeek: minutes, weekCapacity: week.capacity, weekDemand: week.items.reduce((s, i) => s + i.demand, 0) }
          : null,
      slot,
      linkableHabit: pickLinkableHabit(goal.goalText, habits),
      moodDown,
    });
  };
  return withTimeout(
    run().catch((err) => {
      console.warn('[goal-intake] short failed:', err);
      return null;
    }),
    GOAL_INTAKE_BUDGET_MS,
    null,
  );
}
