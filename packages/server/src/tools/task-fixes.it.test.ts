import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskTool } from './create-task.js';
import { completeTaskTool } from './complete-task.js';
import { cancelTaskTool } from './cancel-task.js';
import { getTasksTool } from './get-tasks.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'T', passwordHash: 'x' } });
  return u.id;
}

describe('task fixes — реальная БД', () => {
  it('A: create_task чистит хвостовой предлог/дату в названии', async () => {
    const userId = await seedUser('tf-a@a.test');
    await createTaskTool.handler(
      { title: 'написать отчёт на сегодня', date: '2026-06-05' },
      { userId },
    );
    const t = await prisma.task.findFirst({ where: { userId } });
    expect(t?.title).toBe('написать отчёт');
  });

  it('B: complete_task находит по «грязному» вводу (длиннее хранимого)', async () => {
    const userId = await seedUser('tf-b@a.test');
    await createTaskTool.handler(
      { title: 'подготовить презентацию завтра', date: '2026-06-05' },
      { userId },
    );
    // юзер пишет с лишним хвостом — раньше contains промахивался
    const res = (await completeTaskTool.handler(
      { title: 'подготовить презентацию на сегодня' },
      { userId },
    )) as { notFound?: boolean };
    expect(res.notFound).toBeUndefined();
    const t = await prisma.task.findFirst({ where: { userId } });
    expect(t?.completed).toBe(true);
  });

  it('B: cancel_task мягко убирает (обратимо), get_tasks её прячет', async () => {
    const userId = await seedUser('tf-c@a.test');
    await createTaskTool.handler(
      { title: 'купить молоко', date: '2026-06-05' },
      { userId },
    );
    await cancelTaskTool.handler({ title: 'молоко' }, { userId });
    const t = await prisma.task.findFirst({ where: { userId } });
    expect(t?.cancelled).toBe(true);
    const out = (await getTasksTool.handler({ date: '2026-06-05' }, { userId })) as {
      tasks: Array<{ title: string }>;
    };
    expect(out.tasks.find((x) => x.title.includes('молоко'))).toBeUndefined();
  });

  it('C: get_tasks отдаёт overduePending с прошлых дней', async () => {
    const userId = await seedUser('tf-d@a.test');
    // прямой seed: невыполненная задача в прошлом
    await prisma.task.create({
      data: {
        userId,
        title: 'старая задача',
        category: 'personal',
        priority: 'medium',
        date: new Date('2026-06-01'),
        completed: false,
      },
    });
    const out = (await getTasksTool.handler({}, { userId })) as {
      overduePending: number;
    };
    expect(out.overduePending).toBeGreaterThanOrEqual(1);
  });
});
