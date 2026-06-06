import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deleteIncomeTool } from './delete-income.js';

const prisma = new PrismaClient();

function mkUser(email: string) {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x' } });
}
function mkIncome(userId: string, amount: number, source: string, date = new Date('2026-06-06T00:00:00Z')) {
  return prisma.income.create({ data: { userId, date, amount, source } });
}
async function del(userId: string, input: Record<string, unknown>) {
  return (await deleteIncomeTool.handler(input as never, { userId } as never)) as {
    message: string;
    deletedId: string;
  };
}

describe('delete_income — откат дохода', () => {
  it('последний доход удаляется реально', async () => {
    const u = await mkUser('a@delinc.test');
    await mkIncome(u.id, 350000, 'зарплата');
    const last = await mkIncome(u.id, 50000, 'фриланс');
    const res = await del(u.id, { last: true });
    expect(res.deletedId).toBe(last.id);
    expect(await prisma.income.count({ where: { userId: u.id } })).toBe(1);
    expect(res.message).toContain('50000');
  });

  it('матч по источнику', async () => {
    const u = await mkUser('b@delinc.test');
    await mkIncome(u.id, 350000, 'зарплата');
    const fl = await mkIncome(u.id, 50000, 'фриланс');
    const res = await del(u.id, { source: 'фриланс' });
    expect(res.deletedId).toBe(fl.id);
    expect(await prisma.income.findUnique({ where: { id: fl.id } })).toBeNull();
  });

  it('нет совпадения → throws', async () => {
    const u = await mkUser('c@delinc.test');
    await mkIncome(u.id, 100000, 'зарплата');
    await expect(del(u.id, { source: 'казино' })).rejects.toThrow();
    expect(await prisma.income.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cross-user: чужой доход не трогается', async () => {
    const a = await mkUser('d@delinc.test');
    const b = await mkUser('e@delinc.test');
    const bInc = await mkIncome(b.id, 50000, 'зп');
    await expect(del(a.id, { last: true })).rejects.toThrow();
    expect(await prisma.income.findUnique({ where: { id: bInc.id } })).not.toBeNull();
  });
});
