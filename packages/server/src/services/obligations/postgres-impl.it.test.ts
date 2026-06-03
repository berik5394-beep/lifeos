import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createObligation, listObligations, settleObligation } from './postgres-impl.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function makeUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'O', passwordHash: 'x' } });
  return u.id;
}

describe('obligations store — реальная БД', () => {
  it('create → list(open) → settle → пропадает из open', async () => {
    const userId = await makeUser('obl-a@a.test');
    const o = await createObligation({
      userId,
      personName: 'Серик',
      direction: 'i_owe',
      kind: 'action',
      description: 'договор',
      source: 'manual',
    });
    const open = await listObligations(userId, { status: 'open' });
    expect(open.map((x) => x.id)).toContain(o.id);
    const settled = await settleObligation(userId, o.id);
    expect(settled?.status).toBe('done');
    expect(await listObligations(userId, { status: 'open' })).toHaveLength(0);
  });

  it('cross-user изоляция: B не видит и не закрывает обязательство A', async () => {
    const a = await makeUser('obl-iso-a@a.test');
    const b = await makeUser('obl-iso-b@a.test');
    const o = await createObligation({
      userId: a,
      personName: 'Ахмет',
      direction: 'owed_to_me',
      kind: 'money',
      amount: 500000,
      description: 'долг',
      source: 'manual',
    });
    expect(await listObligations(b, { status: 'open' })).toHaveLength(0);
    expect(await settleObligation(b, o.id)).toBeNull();
    const row = await prisma.obligation.findUnique({ where: { id: o.id } });
    expect(row?.status).toBe('open');
  });
});
