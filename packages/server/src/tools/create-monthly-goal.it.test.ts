import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createMonthlyGoalTool } from './create-monthly-goal.js';
import { getMonthlyPlanTool } from './get-monthly-plan.js';
import { localMonthOnlyUTC } from '../lib/tz.js';

/**
 * create_monthly_goal — РЕАЛЬНО пишет MonthlyGoal на 1-е число месяца юзера +
 * КРОСС-ДОМЕН: живой ридер get_monthly_plan (та же SSOT localMonthOnlyUTC)
 * сразу видит цель. Real prisma, zero vi.mock.
 */
const prisma = new PrismaClient();

function mkUser(email: string, timezone = 'Asia/Almaty') {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x', timezone } });
}
async function create(userId: string, goalText: string) {
  return (await createMonthlyGoalTool.handler({ goalText } as never, { userId } as never)) as {
    message: string;
    monthlyGoalId: string;
    existed?: boolean;
  };
}
async function plan(userId: string) {
  return (await getMonthlyPlanTool.handler({} as never, { userId } as never)) as {
    total: number;
    done: number;
    goals: { text: string; done: boolean }[];
  };
}

describe('create_monthly_goal — цель месяца + кросс-домен', () => {
  it('пишет на 1-е число месяца юзера (localMonthOnlyUTC)', async () => {
    const u = await mkUser('a@mg.test');
    const res = await create(u.id, 'закрыть 3 сделки');
    const row = await prisma.monthlyGoal.findUnique({ where: { id: res.monthlyGoalId } });
    expect(row?.goalText).toBe('закрыть 3 сделки');
    expect(row?.monthStart.toISOString()).toBe(localMonthOnlyUTC('Asia/Almaty').toISOString());
  });

  it('КРОСС-ДОМЕН: get_monthly_plan (живой ридер) сразу видит цель', async () => {
    const u = await mkUser('b@mg.test');
    await create(u.id, 'нанять дизайнера');
    const p = await plan(u.id);
    expect(p.total).toBe(1);
    expect(p.goals.map((g) => g.text)).toContain('нанять дизайнера');
  });

  it('дедуп: повтор той же цели (регистр) не плодит', async () => {
    const u = await mkUser('c@mg.test');
    await create(u.id, 'выпустить релиз');
    const dup = await create(u.id, 'Выпустить релиз');
    expect(dup.existed).toBe(true);
    expect(await prisma.monthlyGoal.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cross-user: цель A не видна в плане B', async () => {
    const a = await mkUser('d@mg.test');
    const b = await mkUser('e@mg.test');
    await create(a.id, 'личная цель А');
    expect((await plan(b.id)).total).toBe(0);
  });
});
