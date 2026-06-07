import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildNeglectedKeyPerson } from './impl.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const DAY = 86_400_000;
const STALE_AT = new Date(Date.now() - 40 * DAY);

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x' } });
  return u.id;
}
function mkPerson(userId: string, name: string, attrs: object, importance = 6) {
  return prisma.entity.create({ data: { userId, type: 'person', name, importance, lastSeenAt: STALE_AT, attributes: attrs as never } });
}

describe('buildNeglectedKeyPerson — real prisma', () => {
  it('типизированный застоявшийся клиент → нудж', async () => {
    const u = await mkUser('nk-a@a.test');
    await mkPerson(u, 'Ахмет', { personType: 'client' });
    const r = await buildNeglectedKeyPerson(u);
    expect(r?.name).toBe('Ахмет');
    expect(r?.type).toBe('client');
  });
  it('+ owed_to_me money obligation → сумма в payload', async () => {
    const u = await mkUser('nk-b@a.test');
    const e = await mkPerson(u, 'Серик', { personType: 'client' });
    await prisma.obligation.create({ data: { userId: u, personEntityId: e.id, personName: 'Серик', direction: 'owed_to_me', kind: 'money', amount: 200000, description: 'оплата', status: 'open', source: 'manual' } });
    const r = await buildNeglectedKeyPerson(u);
    expect(r?.owed).toBe(200000);
  });
  it('нет типизированных и importance<7 → null', async () => {
    const u = await mkUser('nk-c@a.test');
    await mkPerson(u, 'Знакомый', {}, 6);
    expect(await buildNeglectedKeyPerson(u)).toBeNull();
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('nk-iso-a@a.test');
    const b = await mkUser('nk-iso-b@a.test');
    await mkPerson(a, 'Бекзат', { personType: 'investor' });
    expect(await buildNeglectedKeyPerson(b)).toBeNull();
  });
});
