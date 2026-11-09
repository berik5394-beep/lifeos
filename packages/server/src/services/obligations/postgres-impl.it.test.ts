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

describe('частичный возврат долга (аудит 2026-11-09)', () => {
  it('вернул 200к из 500к → осталось 300к, открыт; повторное закрытие закрытого — alreadyClosed', async () => {
    const userId = await makeUser(`obl-part-${Date.now()}@a.test`);
    const o = await createObligation({ userId, personName: 'Ахмет', direction: 'owed_to_me', kind: 'money', description: 'должен мне', amount: 500000, source: 'manual' });
    const p = await settleObligation(userId, o.id, { paidAmount: 200000 });
    expect(p).toMatchObject({ status: 'open', amount: 300000, paid: 200000, remaining: 300000, alreadyClosed: false });
    const full = await settleObligation(userId, o.id);
    expect(full).toMatchObject({ status: 'done', paid: 300000, remaining: 0 });
    expect(await settleObligation(userId, o.id)).toMatchObject({ alreadyClosed: true });
  });
});
