import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { goalLivePercent, userCalendar, withLiveProgress } from './life-facts.js';
import { getGoalProgressTool } from '../tools/get-goal-progress.js';
import { gatherPortraitFacts } from './portrait.js';

/**
 * Робот = одно приложение: денежная цель — один процент на экране, в чате, в
 * «как я иду к цели», в портрете (раньше экран 40 %, остальные 0 %).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
async function setup(tag: string) {
  const u = await prisma.user.create({
    data: { email: `lf-${tag}-${Date.now()}@a.test`, name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  const { year } = await userCalendar(u.id);
  const goal = await prisma.yearlyGoal.create({
    data: { userId: u.id, year, area: 'finance', goalText: 'Накопить миллион', progress: 0, target: 1_000_000 },
  });
  const day = new Date(Date.now() + 60_000);
  await prisma.income.create({ data: { userId: u.id, date: day, source: 'зарплата', amount: 500_000 } });
  await prisma.expense.create({ data: { userId: u.id, date: day, category: 'food', description: 'еда', amount: 100_000 } });
  return { userId: u.id, goal };
}

describe('life-facts: живой прогресс цели — один для всех', () => {
  it('денежная цель = накоплено / цель (40 %), а не сохранённые 0 %', async () => {
    const { userId, goal } = await setup('a');
    expect(await goalLivePercent(userId, goal)).toBe(40);
    const [g] = await withLiveProgress(userId, [goal]);
    expect(g.progress).toBe(40);
  });

  it('не денежная цель — сохранённый progress', async () => {
    const { userId } = await setup('b');
    expect(await goalLivePercent(userId, { area: 'health', progress: 63.4, target: null, createdAt: new Date() })).toBe(63);
  });

  it('инструмент «как я иду к цели» и портрет видят те же 40 %', async () => {
    const { userId } = await setup('c');
    const tool = (await getGoalProgressTool.handler({} as never, { userId } as never)) as {
      goals: Array<{ goal: string; progressPct: number }>;
    };
    expect(tool.goals.find((x) => x.goal === 'Накопить миллион')?.progressPct).toBe(40);
    const facts = await gatherPortraitFacts(userId);
    expect(facts.join('\n')).toMatch(/Накопить миллион[^\n]*40/);
  });

  it('портрет не считает отменённые задачи', async () => {
    const { userId } = await setup('d');
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await prisma.task.createMany({
      data: [
        { userId, title: 'сделал 1', category: 'work', priority: 'medium', date: today, completed: true },
        { userId, title: 'сделал 2', category: 'work', priority: 'medium', date: today, completed: true },
        { userId, title: 'висит', category: 'work', priority: 'medium', date: today },
        { userId, title: 'отменил', category: 'work', priority: 'medium', date: today, cancelled: true },
      ],
    });
    const facts = (await gatherPortraitFacts(userId)).join('\n');
    expect(facts).toMatch(/задачи за 2 недели: закрыто 2 из 3/);
  });
});
