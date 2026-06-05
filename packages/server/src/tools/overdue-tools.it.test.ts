import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getTasksTool } from './get-tasks.js';
import { clearOverdueTool } from './clear-overdue.js';
import { deferOverdueTool } from './defer-overdue.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'O', passwordHash: 'x' } });
  return u.id;
}

const past = (d: string) => ({ category: 'personal', priority: 'medium', date: new Date(d), completed: false });

describe('overdue tools — реальная БД', () => {
  it('get_tasks отдаёт сэмпл-список просрочек', async () => {
    const userId = await seedUser('ov-a@a.test');
    await prisma.task.create({ data: { userId, title: 'старая 1', ...past('2026-06-01') } });
    await prisma.task.create({ data: { userId, title: 'старая 2', ...past('2026-06-02') } });
    const out = (await getTasksTool.handler({}, { userId })) as {
      overduePending: number;
      overdue: Array<{ title: string }>;
    };
    expect(out.overduePending).toBe(2);
    expect(out.overdue.map((x) => x.title).sort()).toEqual(['старая 1', 'старая 2']);
  });

  it('clear_overdue отменяет ВСЕ просрочки, не трогает будущие/выполненные', async () => {
    const userId = await seedUser('ov-b@a.test');
    await prisma.task.create({ data: { userId, title: 'просрочка', ...past('2026-06-01') } });
    await prisma.task.create({ data: { userId, title: 'выполнена', ...past('2026-06-01'), completed: true } });
    await prisma.task.create({ data: { userId, title: 'будущая', category: 'personal', priority: 'medium', date: new Date('2026-12-01'), completed: false } });
    const res = (await clearOverdueTool.handler({}, { userId })) as { count: number };
    expect(res.count).toBe(1);
    const cancelled = await prisma.task.findMany({ where: { userId, cancelled: true } });
    expect(cancelled.map((t) => t.title)).toEqual(['просрочка']);
    // будущая и выполненная — не тронуты
    expect(await prisma.task.count({ where: { userId, cancelled: false } })).toBe(2);
  });

  it('defer_overdue переносит ВСЕ просрочки на сегодня', async () => {
    const userId = await seedUser('ov-c@a.test');
    await prisma.task.create({ data: { userId, title: 'хвост 1', ...past('2026-06-01') } });
    await prisma.task.create({ data: { userId, title: 'хвост 2', ...past('2026-06-03') } });
    const res = (await deferOverdueTool.handler({}, { userId })) as { count: number };
    expect(res.count).toBe(2);
    // после переноса просрочек больше нет
    const out = (await getTasksTool.handler({}, { userId })) as { overduePending: number };
    expect(out.overduePending).toBe(0);
  });
});
