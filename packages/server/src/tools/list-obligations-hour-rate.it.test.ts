import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listObligationsTool } from './list-obligations.js';
import { setHourRateTool } from './set-hour-rate.js';

/** Аудит 2026-11-08: на list_obligations и set_hour_rate не было ни одного теста. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user(tag: string, settings: object = {}) {
  const u = await prisma.user.create({
    data: { email: `loh-${tag}-${Date.now()}@a.test`, name: 'T', passwordHash: 'x', settings },
  });
  return u.id;
}

type Listed = { obligations: Array<{ direction: string; person: string; amount: number | null; due: string | null }> };

describe('list_obligations', () => {
  it('только открытые и только свои; направление и человек фильтруют', async () => {
    const userId = await user('a');
    const other = await user('b');
    await prisma.obligation.createMany({
      data: [
        { userId, personName: 'Серик', direction: 'i_owe', kind: 'money', description: 'долг', amount: 50000, status: 'open', source: 'manual' },
        { userId, personName: 'Айгуль', direction: 'owed_to_me', kind: 'money', description: 'заём', amount: 20000, status: 'open', source: 'manual', dueDate: new Date('2026-12-01T00:00:00Z') },
        { userId, personName: 'Серик', direction: 'i_owe', kind: 'money', description: 'старый', amount: 1000, status: 'done', source: 'manual' },
        { userId: other, personName: 'Чужой', direction: 'i_owe', kind: 'money', description: 'чужой', amount: 7, status: 'open', source: 'manual' },
      ],
    });

    const all = (await listObligationsTool.handler({} as never, { userId } as never)) as Listed;
    expect(all.obligations.map((o) => o.person).sort()).toEqual(['Айгуль', 'Серик']);

    const mine = (await listObligationsTool.handler({ direction: 'я должен' } as never, { userId } as never)) as Listed;
    expect(mine.obligations).toEqual([expect.objectContaining({ direction: 'i_owe', person: 'Серик', amount: 50000 })]);

    const aigul = (await listObligationsTool.handler({ personName: 'Айгуль' } as never, { userId } as never)) as Listed;
    expect(aigul.obligations).toEqual([expect.objectContaining({ person: 'Айгуль', due: '2026-12-01' })]);
  });

  it('обязательств нет — пустой список, а не ошибка', async () => {
    const userId = await user('c');
    const out = (await listObligationsTool.handler({} as never, { userId } as never)) as Listed;
    expect(out.obligations).toEqual([]);
  });
});

describe('set_hour_rate', () => {
  it('пишет ставку в settings.hourRate (целое), не затирая другие настройки', async () => {
    const userId = await user('d', { theme: 'pink', notify: { morning: true } });
    const out = (await setHourRateTool.handler({ rate: 20000.4 } as never, { userId } as never)) as { rate: number; message: string };
    expect(out.rate).toBe(20000);
    expect(out.message).toMatch(/Запомнил/);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { settings: true } });
    expect(u.settings).toMatchObject({ hourRate: 20000, theme: 'pink', notify: { morning: true } });
  });

  it('повторная ставка перезаписывает прежнюю', async () => {
    const userId = await user('e');
    await setHourRateTool.handler({ rate: 10000 } as never, { userId } as never);
    await setHourRateTool.handler({ rate: 15000 } as never, { userId } as never);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { settings: true } });
    expect((u.settings as { hourRate: number }).hourRate).toBe(15000);
  });
});
