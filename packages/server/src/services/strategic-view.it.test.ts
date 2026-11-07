import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherStrategicFacts, driftVerdict } from './strategic-view.js';
import { localDateOnlyUTC } from '../lib/tz.js';

/** «Взгляд сверху» по реальным связям: задача → цель недели → цель года, привычка → цель. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const TZ = 'Asia/Almaty';
const NOW = new Date('2026-11-08T14:00:00Z'); // воскресенье, Алматы 19:00
const TODAY = localDateOnlyUTC(TZ, NOW);
const DAY = 86_400_000;
const old = new Date(NOW.getTime() - 60 * DAY);
const user = async () =>
  (await prisma.user.create({ data: { email: `sv-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: TZ } })).id;
const goal = (u: string, goalText: string, progress: number) =>
  prisma.yearlyGoal.create({ data: { userId: u, year: 2026, area: 'finance', goalText, progress, createdAt: old, updatedAt: old } });
const doneTasks = (u: string, n: number, extra: Record<string, unknown> = {}) =>
  Promise.all(
    Array.from({ length: n }, (_, i) =>
      prisma.task.create({
        data: { userId: u, title: `дело ${i}`, category: 'work', priority: 'medium', completed: true, date: new Date(TODAY.getTime() - (i % 20) * DAY), ...extra },
      }),
    ),
  );

describe('gatherStrategicFacts', () => {
  it('текучка без связи с целью → цель «стоит», фраза', async () => {
    const u = await user();
    await goal(u, 'Миллион', 12);
    await doneTasks(u, 9);
    const f = await gatherStrategicFacts(u, TZ, NOW);
    expect(f).toMatchObject({ weeks: 3, tasksDone: 9, goalSteps: 0 });
    expect(driftVerdict(f)?.text).toMatch(/закрыто 9 дел — и ни одно не про цель «Миллион» \(она на 12%\)/);
  });

  it('задача → цель недели → цель года считается шагом; курс держится — молчим', async () => {
    const u = await user();
    const g = await goal(u, 'Миллион', 12);
    const w = await prisma.weeklyGoal.create({
      data: { userId: u, weekStart: TODAY, goalText: 'найти 3 клиентов', planParentId: g.id, planParentType: 'YearlyGoal' },
    });
    await doneTasks(u, 7);
    await doneTasks(u, 2, { planParentId: w.id, planParentType: 'WeeklyGoal' });
    const f = await gatherStrategicFacts(u, TZ, NOW);
    expect(f.goalSteps).toBe(2);
    expect(f.goals[0].steps).toBe(2);
    expect(driftVerdict(f)).toBeNull();
  });

  it('отметки привычки, привязанной к цели, — тоже шаги', async () => {
    const u = await user();
    const g = await goal(u, 'Книги', 30);
    const h = await prisma.habit.create({ data: { userId: u, name: 'Чтение', category: 'personal', frequency: 'daily', goalId: g.id } });
    await prisma.habitLog.create({ data: { userId: u, habitId: h.id, date: TODAY, completed: true } });
    await doneTasks(u, 8);
    const f = await gatherStrategicFacts(u, TZ, NOW);
    expect(f.goals[0]).toMatchObject({ goalText: 'Книги', steps: 1 });
    expect(driftVerdict(f)).toBeNull();
  });

  it('цель поставлена на днях — «стоящей» не называем; старые задачи вне окна не считаются', async () => {
    const u = await user();
    await prisma.yearlyGoal.create({ data: { userId: u, year: 2026, area: 'finance', goalText: 'Новая', progress: 0 } });
    await doneTasks(u, 3);
    await prisma.task.create({ data: { userId: u, title: 'давно', category: 'work', priority: 'low', completed: true, date: new Date(TODAY.getTime() - 40 * DAY) } });
    const f = await gatherStrategicFacts(u, TZ, NOW);
    expect(f.goals).toEqual([]);
    expect(f.tasksDone).toBe(3);
  });

  it('чужие задачи и цели не попадают', async () => {
    const a = await user();
    const b = await user();
    await goal(a, 'Миллион', 12);
    await doneTasks(a, 9);
    const f = await gatherStrategicFacts(b, TZ, NOW);
    expect(f).toMatchObject({ tasksDone: 0, goals: [] });
  });
});
