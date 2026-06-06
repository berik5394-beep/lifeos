import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createWeeklyGoalTool } from './create-weekly-goal.js';
import { getWeeklyPlanTool } from './get-weekly-plan.js';
import { localWeekStartUTC } from '../lib/tz.js';

/**
 * create_weekly_goal — РЕАЛЬНО пишет WeeklyGoal на понедельник недели юзера +
 * КРОСС-ДОМЕН: живой ридер get_weekly_plan (та же SSOT-точка localWeekStartUTC)
 * сразу видит цель. Real prisma, zero vi.mock.
 */
const prisma = new PrismaClient();

function mkUser(email: string, timezone = 'Asia/Almaty') {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x', timezone } });
}
async function create(userId: string, goalText: string) {
  return (await createWeeklyGoalTool.handler({ goalText } as never, { userId } as never)) as {
    message: string;
    weeklyGoalId: string;
    existed?: boolean;
  };
}
async function plan(userId: string) {
  return (await getWeeklyPlanTool.handler({} as never, { userId } as never)) as {
    total: number;
    done: number;
    goals: { text: string; done: boolean }[];
  };
}

describe('create_weekly_goal — цель недели + кросс-домен', () => {
  it('пишет на понедельник недели юзера (localWeekStartUTC)', async () => {
    const u = await mkUser('a@wg.test');
    const res = await create(u.id, 'закрыть отчёт');
    const row = await prisma.weeklyGoal.findUnique({ where: { id: res.weeklyGoalId } });
    expect(row?.goalText).toBe('закрыть отчёт');
    expect(row?.weekStart.toISOString()).toBe(localWeekStartUTC('Asia/Almaty').toISOString());
  });

  it('КРОСС-ДОМЕН: get_weekly_plan (живой ридер) сразу видит цель', async () => {
    const u = await mkUser('b@wg.test');
    await create(u.id, '3 тренировки');
    const p = await plan(u.id);
    expect(p.total).toBe(1);
    expect(p.goals.map((g) => g.text)).toContain('3 тренировки');
  });

  it('дедуп: повтор той же цели (регистр) не плодит', async () => {
    const u = await mkUser('c@wg.test');
    await create(u.id, 'дочитать книгу');
    const dup = await create(u.id, 'Дочитать книгу');
    expect(dup.existed).toBe(true);
    expect(await prisma.weeklyGoal.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cross-user: цель A не видна в плане B', async () => {
    const a = await mkUser('d@wg.test');
    const b = await mkUser('e@wg.test');
    await create(a.id, 'личная цель А');
    expect((await plan(b.id)).total).toBe(0);
  });
});
