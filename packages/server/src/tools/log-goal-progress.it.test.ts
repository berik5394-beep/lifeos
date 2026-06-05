import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { logGoalProgressTool } from './log-goal-progress.js';
import { updateGoalProgressTool } from './update-goal-progress.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'LG', passwordHash: 'x' } });
  return u.id;
}

const YEAR = new Date().getUTCFullYear();

describe('log_goal_progress — чек-ин нечисловой цели + оживляет нуду (тест-БД)', () => {
  it('находит НЕЧИСЛОВУЮ цель (target=null), где update_goal_progress пасует', async () => {
    const userId = await seedUser(`lg-a-${Date.now()}@a.test`);
    await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'spirituality', goalText: 'Духовный рост', target: null } });
    // update_goal_progress НЕ находит нечисловую (фильтр target:{not:null})
    const u = (await updateGoalProgressTool.handler({ goalQuery: 'духовн', value: 5 } as never, { userId } as never)) as { message: string };
    expect(u.message).toMatch(/[Нн]е нашёл/);
    // log_goal_progress — находит и пишет
    const r = (await logGoalProgressTool.handler({ goalQuery: 'духовн', note: 'медитировал всю неделю' } as never, { userId } as never)) as { message: string };
    expect(r.message).toContain('Духовный рост');
    expect(r.message).toContain('медитировал');
  });

  it('гасит нуду: updatedAt сдвигается вперёд', async () => {
    const userId = await seedUser(`lg-b-${Date.now()}@a.test`);
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'spirituality', goalText: 'Спокойствие', target: null } });
    // raw-SQL: @updatedAt managed — Prisma update перезапишет ручную дату, поэтому форсим через SQL.
    await prisma.$executeRaw`UPDATE "YearlyGoal" SET "updatedAt" = ${old} WHERE id = ${goal.id}`;
    await logGoalProgressTool.handler({ goalQuery: 'спокой', note: 'дышал по утрам' } as never, { userId } as never);
    const after = await prisma.yearlyGoal.findUnique({ where: { id: goal.id } });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('percent → progress (кламп)', async () => {
    const userId = await seedUser(`lg-c-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'spirituality', goalText: 'Гармония', target: null } });
    await logGoalProgressTool.handler({ goalQuery: 'гармон', note: 'прогресс', percent: 150 } as never, { userId } as never);
    const after = await prisma.yearlyGoal.findUnique({ where: { id: goal.id } });
    expect(after!.progress).toBe(100);
  });

  it('0 целей → честный месседж, ничего не пишет', async () => {
    const userId = await seedUser(`lg-d-${Date.now()}@a.test`);
    const r = (await logGoalProgressTool.handler({ goalQuery: 'выдуманная', note: 'x' } as never, { userId } as never)) as { message: string };
    expect(r.message).toMatch(/[Нн]е нашёл/);
  });

  it('cross-user: B не двигает цель A', async () => {
    const a = await seedUser(`lg-e1-${Date.now()}@a.test`);
    const b = await seedUser(`lg-e2-${Date.now()}@a.test`);
    await prisma.yearlyGoal.create({ data: { userId: a, year: YEAR, area: 'spirituality', goalText: 'Медитация', target: null } });
    const r = (await logGoalProgressTool.handler({ goalQuery: 'медитац', note: 'x' } as never, { userId: b } as never)) as { message: string };
    expect(r.message).toMatch(/[Нн]е нашёл/);
  });

  it('строковый percent коэрсится через runRegistryTool', async () => {
    const userId = await seedUser(`lg-f-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'spirituality', goalText: 'Осознанность', target: null } });
    const { runRegistryTool } = await import('./index.js');
    await runRegistryTool('log_goal_progress', { goalQuery: 'осознан', note: 'практиковал', percent: '40' }, { userId });
    const after = await prisma.yearlyGoal.findUnique({ where: { id: goal.id } });
    expect(after!.progress).toBe(40);
  });
});
