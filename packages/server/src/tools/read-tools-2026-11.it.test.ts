import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRegistryTool } from './index.js';

/** Аудит 2026-11-07: мозг не мог прочитать привычки, дневник, баланс, решения и граф людей. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user() {
  return (await prisma.user.create({ data: { email: `rt-${Date.now()}-${Math.random()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } })).id;
}
const run = (name: string, userId: string, input: unknown = {}) =>
  runRegistryTool(name, input, { userId, channel: 'text' } as never) as Promise<Record<string, unknown>>;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

describe('новые инструменты чтения мозга', () => {
  it('get_habits: сделано сегодня и за 7 дней', async () => {
    const u = await user();
    const h = await prisma.habit.create({ data: { userId: u, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    await prisma.habitLog.create({ data: { userId: u, habitId: h.id, date: today(), completed: true } });
    const r = await run('get_habits', u);
    expect(r.habits).toEqual([{ name: 'Зарядка', category: 'health', doneToday: true, doneLast7Days: 1 }]);
  });

  it('get_journal: записи дневника и заметки недели', async () => {
    const u = await user();
    await prisma.journalEntry.create({ data: { userId: u, date: today(), sleepHours: 7, mood: 8, energy: 6, notes: 'хороший день' } });
    const r = await run('get_journal', u, { days: 3 });
    expect(r.entries).toEqual([{ date: today().toISOString().slice(0, 10), sleepHours: 7, energy: 6, mood: 8, notes: 'хороший день' }]);
  });

  it('get_balance: без названного баланса — честно «нет», с балансом — оценка с учётом трат после', async () => {
    const u = await user();
    expect((await run('get_balance', u)).lastStatedBalance).toBeNull();
    await prisma.cashSnapshot.create({ data: { userId: u, balance: 100000, asOf: new Date('2026-01-01T00:00:00Z') } });
    await prisma.expense.create({ data: { userId: u, date: new Date('2026-01-05T00:00:00Z'), category: 'food', description: 'еда', amount: 30000 } });
    const r = await run('get_balance', u);
    expect(r.estimateNow).toBe(70000);
  });

  it('list_decisions: открытые и проверенные', async () => {
    const u = await user();
    await prisma.decision.create({ data: { userId: u, title: 'Сменить работу', reviewDate: new Date('2026-12-01T00:00:00Z') } });
    const r = await run('list_decisions', u);
    expect((r.open as Array<{ title: string }>)[0].title).toBe('Сменить работу');
  });

  it('recall_person: читает граф людей (факты), а не только контакты', async () => {
    const u = await user();
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', attributes: { role: 'брат' }, importance: 8 } });
    const r = await run('recall_person', u, { name: 'Серик' });
    expect((r.people as Array<{ name: string }>)[0].name).toBe('Серик');
  });
});
