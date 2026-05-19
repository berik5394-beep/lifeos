import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getRelevantMemories } from '../services/memory-service.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.7 (последний read-tool) — миграция get_goal_progress в
 * реестр. Логика 1:1 (Phase 2.5: память ↔ YearlyGoal ↔ Task).
 * После этого все 7 agent-tools в реестре → 9A.8 финальный свич.
 */

const AREA_TO_CAT: Record<string, string> = {
  finance: 'finance',
  health: 'health',
  career: 'work',
  spirituality: 'personal',
};

export const getGoalProgressTool = defineTool({
  name: 'get_goal_progress',
  description:
    'Прогресс по годовым целям: реальный % vs темп года + ' +
    'связанные задачи + что юзер сам говорил про эту цель (память). ' +
    'Вызывай на «как я иду к цели», «что с финансовой целью», ' +
    '«отстаю ли я по здоровью».',
  category: 'info',
  schema: z.object({
    area: z.string().max(40).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['как я иду к цели', 'что с финансовой целью'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const elapsedPct = Math.round(
      ((now.getTime() - yearStart.getTime()) /
        (yearEnd.getTime() - yearStart.getTime())) *
        100,
    );
    const area = input.area ? String(input.area).toLowerCase().trim() : null;

    const goals = await prisma.yearlyGoal.findMany({
      where: {
        userId,
        year,
        ...(area ? { area: { equals: area, mode: 'insensitive' } } : {}),
      },
      select: { id: true, area: true, goalText: true, progress: true },
    });

    // L99/W8 — честный сигнал наличия плана (не молчаливый void).
    // ВАЖНО: точный planStale (target ≠ дети) НЕ вычислим — у
    // WeeklyGoal/YearlyGoal нет ни child-target, ни timestamps;
    // выдумывать сигнал = bug #1. Поэтому surface ФАКТ плана +
    // честная оговорка; истинный stale-detect гейтнут на ту же
    // схему-миграцию, что W2/4-5 (см. ISSUE-Z).
    const goalIds = goals.map((g) => g.id);
    const [planWeeks, planHabits] = await Promise.all([
      goalIds.length
        ? prisma.weeklyGoal.groupBy({
            by: ['planParentId'],
            where: {
              userId,
              derivedFrom: 'planner',
              planParentId: { in: goalIds },
              archivedAt: null, // 4/5: только АКТИВНЫЙ план
            },
            _count: { _all: true },
          })
        : Promise.resolve(
            [] as Array<{
              planParentId: string | null;
              _count: { _all: number };
            }>,
          ),
      goalIds.length
        ? prisma.habit.findMany({
            where: {
              userId,
              derivedFrom: 'planner',
              planParentId: { in: goalIds },
              archivedAt: null, // 4/5: только АКТИВНЫЙ план
            },
            select: { planParentId: true, name: true },
          })
        : Promise.resolve(
            [] as Array<{ planParentId: string | null; name: string }>,
          ),
    ]);
    const weeksByGoal = new Map<string, number>();
    for (const r of planWeeks)
      if (r.planParentId) weeksByGoal.set(r.planParentId, r._count._all);
    const habitByGoal = new Map<string, string>();
    for (const h of planHabits)
      if (h.planParentId && !habitByGoal.has(h.planParentId))
        habitByGoal.set(h.planParentId, h.name);

    const cats = Array.from(
      new Set(
        goals
          .map((g) => AREA_TO_CAT[g.area.toLowerCase()])
          .filter((c): c is string => !!c),
      ),
    );
    const taskStats: Record<string, { completed: number; total: number }> = {};
    await Promise.all(
      cats.map(async (cat) => {
        const [total, completed] = await Promise.all([
          prisma.task.count({
            where: { userId, category: cat, date: { gte: yearStart } },
          }),
          prisma.task.count({
            where: {
              userId,
              category: cat,
              completed: true,
              date: { gte: yearStart },
            },
          }),
        ]);
        taskStats[cat] = { completed, total };
      }),
    );

    const memQuery = area || goals.map((g) => g.goalText).join(' ') || 'цель';
    const remembered = await getRelevantMemories(userId, memQuery, 5);

    return {
      yearElapsedPct: elapsedPct,
      goals: goals.map((g) => {
        const pct =
          g.progress > 1
            ? Math.round(g.progress)
            : Math.round(g.progress * 100);
        const gap = elapsedPct - pct;
        const weeks = weeksByGoal.get(g.id) ?? 0;
        return {
          area: g.area,
          goal: g.goalText,
          progressPct: pct,
          expectedPct: elapsedPct,
          status:
            gap >= 25 ? 'отстаёт' : gap <= -10 ? 'с опережением' : 'в графике',
          relatedTasks: taskStats[AREA_TO_CAT[g.area.toLowerCase()]] ?? null,
          // W8 honest: ФАКТ плана. Без ложного planStale (невычислим).
          plan:
            weeks > 0
              ? {
                  weeks,
                  habit: habitByGoal.get(g.id) ?? null,
                  note: 'План построен планировщиком. Если менял цель — план мог устареть; пересборка будет в ближайшем апдейте.',
                }
              : null,
        };
      }),
      remembered: remembered.map((m) => m.content),
    };
  },
});
