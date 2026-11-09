import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskTool } from './create-task.js';

/** Мозг повторял прошлую команду из истории — второй «Купить хлеб» (2026-11-09). */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `ctd-${tag}-${Date.now()}@a.test`, name: 'T', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('create_task: дубль не плодим', () => {
  it('та же задача на тот же день (точка из голоса, регистр) — вторую не создаём', async () => {
    const userId = await user('a');
    await createTaskTool.handler({ title: 'купить хлеб .', date: '2026-12-01' } as never, { userId } as never);
    const out = (await createTaskTool.handler({ title: 'Купить хлеб', date: '2026-12-01' } as never, { userId } as never)) as {
      duplicate?: boolean;
      message: string;
    };
    expect(out.duplicate).toBe(true);
    expect(out.message).toMatch(/уже есть/);
    expect(await prisma.task.count({ where: { userId } })).toBe(1);
  });

  it('другой день или другое время — это новая задача', async () => {
    const userId = await user('b');
    await createTaskTool.handler({ title: 'Позвонить маме', date: '2026-12-01' } as never, { userId } as never);
    await createTaskTool.handler({ title: 'Позвонить маме', date: '2026-12-02' } as never, { userId } as never);
    await createTaskTool.handler({ title: 'Позвонить маме', date: '2026-12-01', time: '15:00' } as never, { userId } as never);
    expect(await prisma.task.count({ where: { userId } })).toBe(3);
  });
});
