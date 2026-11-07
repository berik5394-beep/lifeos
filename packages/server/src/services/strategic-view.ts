/**
 * «Взгляд сверху» (docs/plan/jarvis-roadmap.md №2). Джарвис не только
 * напоминает про дни, но и говорит о курсе: «Три недели закрываешь текучку,
 * а цель „Миллион“ стоит — вернись к главному».
 *
 * Факты — только из БД: закрытые задачи за окно, какие из них РЕАЛЬНО связаны
 * с целью года (задача → цель недели → цель года, или задача → цель года),
 * отметки привычек, привязанных к цели, и двигался ли прогресс цели.
 * Связи нет — шагом к цели не считаем (антифаб). Целей нет — молчим.
 */
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC } from '../lib/tz.js';

const DAY = 86_400_000;
export const DRIFT_WEEKS = 3;
/** Меньше дел за окно — человек не «тушит пожары», говорить не о чем. */
export const DRIFT_MIN_TASKS = 6;
/** Доля шагов к целям среди закрытого, ниже которой — «текучка съедает главное». */
export const DRIFT_MAX_GOAL_SHARE = 0.1;

export interface GoalStat {
  id: string;
  goalText: string;
  progress: number;
  /** Шаги к цели за окно: задачи + отметки привязанных привычек. */
  steps: number;
  /** Прогресс цели обновляли за окно. */
  touched: boolean;
}

export interface StrategicFacts {
  weeks: number;
  tasksDone: number;
  goalSteps: number;
  goals: GoalStat[];
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};

/**
 * Говорить ли о курсе. Нужно всё сразу: цели есть; дел закрыто достаточно
 * (занят); шагов к целям почти нет; есть цель, которая стоит (ни шага и
 * прогресс не трогали). Из стоящих — с наименьшим прогрессом. Чистая.
 */
export function driftVerdict(f: StrategicFacts): { goal: GoalStat; text: string } | null {
  if (f.goals.length === 0 || f.tasksDone < DRIFT_MIN_TASKS) return null;
  if (f.goalSteps / f.tasksDone > DRIFT_MAX_GOAL_SHARE) return null;
  const stalled = f.goals.filter((g) => g.steps === 0 && !g.touched).sort((a, b) => a.progress - b.progress);
  const goal = stalled[0];
  if (!goal) return null;
  const pct = Math.round(goal.progress);
  const text =
    `Взгляд сверху: за ${f.weeks} ${plural(f.weeks, 'неделю', 'недели', 'недель')} закрыто ${f.tasksDone} ` +
    `${plural(f.tasksDone, 'дело', 'дела', 'дел')} — и ни одно не про цель «${goal.goalText}» (она на ${pct}%). ` +
    'Текучка съедает главное. На этой неделе — один шаг к ней? Скажи какой — поставлю в план.';
  return { goal, text };
}

/** Факты за последние `weeks` недель (окно до сегодня включительно, по поясу пользователя). */
export async function gatherStrategicFacts(
  userId: string,
  tz: string,
  now: Date = new Date(),
  weeks: number = DRIFT_WEEKS,
): Promise<StrategicFacts> {
  const today = localDateOnlyUTC(tz, now);
  const from = new Date(today.getTime() - (weeks * 7 - 1) * DAY);
  const since = new Date(now.getTime() - weeks * 7 * DAY);

  const [goalsRaw, tasks, habits] = await Promise.all([
    // Цель должна жить дольше окна: поставленную вчера «стоящей» не называем.
    prisma.yearlyGoal.findMany({
      where: { userId, year: now.getUTCFullYear(), progress: { lt: 100 }, createdAt: { lt: since } },
      select: { id: true, goalText: true, progress: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: { userId, completed: true, date: { gte: from, lte: today } },
      select: { planParentId: true, planParentType: true },
    }),
    prisma.habit.findMany({
      where: { userId, OR: [{ goalId: { not: null } }, { planParentType: 'YearlyGoal' }] },
      select: { id: true, goalId: true, planParentId: true, planParentType: true },
    }),
  ]);

  // Задача → цель недели → цель года.
  const weeklyIds = [...new Set(tasks.filter((t) => t.planParentType === 'WeeklyGoal' && t.planParentId).map((t) => t.planParentId as string))];
  const weekly = weeklyIds.length
    ? await prisma.weeklyGoal.findMany({
        where: { userId, id: { in: weeklyIds }, planParentType: 'YearlyGoal' },
        select: { id: true, planParentId: true },
      })
    : [];
  const weeklyToYearly = new Map(weekly.map((w) => [w.id, w.planParentId as string]));

  const steps = new Map<string, number>();
  const bump = (goalId: string | null | undefined, n = 1) => {
    if (goalId) steps.set(goalId, (steps.get(goalId) ?? 0) + n);
  };
  let goalTaskSteps = 0;
  for (const t of tasks) {
    const yearly =
      t.planParentType === 'YearlyGoal' ? t.planParentId : t.planParentType === 'WeeklyGoal' ? weeklyToYearly.get(t.planParentId ?? '') : null;
    if (yearly) {
      bump(yearly);
      goalTaskSteps += 1;
    }
  }

  // Привычки, привязанные к цели: отметки за окно — тоже шаги.
  const habitGoal = new Map(
    habits.map((h) => [h.id, h.planParentType === 'YearlyGoal' && h.planParentId ? h.planParentId : h.goalId]),
  );
  if (habitGoal.size > 0) {
    const logs = await prisma.habitLog.groupBy({
      by: ['habitId'],
      where: { userId, completed: true, habitId: { in: [...habitGoal.keys()] }, date: { gte: from, lte: today } },
      _count: { _all: true },
    });
    for (const l of logs) bump(habitGoal.get(l.habitId), l._count._all);
  }

  const goals: GoalStat[] = goalsRaw.map((g) => ({
    id: g.id,
    goalText: g.goalText,
    progress: g.progress,
    steps: steps.get(g.id) ?? 0,
    touched: g.updatedAt.getTime() >= since.getTime(),
  }));
  return { weeks, tasksDone: tasks.length, goalSteps: goalTaskSteps, goals };
}
