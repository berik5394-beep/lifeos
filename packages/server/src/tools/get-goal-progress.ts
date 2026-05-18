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
      select: { area: true, goalText: true, progress: true },
    });

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
        return {
          area: g.area,
          goal: g.goalText,
          progressPct: pct,
          expectedPct: elapsedPct,
          status:
            gap >= 25 ? 'отстаёт' : gap <= -10 ? 'с опережением' : 'в графике',
          relatedTasks: taskStats[AREA_TO_CAT[g.area.toLowerCase()]] ?? null,
        };
      }),
      remembered: remembered.map((m) => m.content),
    };
  },
});
