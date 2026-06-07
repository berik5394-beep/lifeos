import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setPersonTypeTool } from './set-person-type.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x' } });
  return u.id;
}
async function setType(userId: string, person: string, type: string) {
  return (await setPersonTypeTool.handler({ person, type } as never, { userId } as never)) as {
    message: string; entityId: string;
  };
}

describe('set_person_type — real prisma', () => {
  it('пишет personType в Entity.attributes', async () => {
    const u = await mkUser('pt-a@a.test');
    const r = await setType(u, 'Ахмет', 'client');
    const e = await prisma.entity.findUnique({ where: { id: r.entityId } });
    expect((e?.attributes as Record<string, unknown>).personType).toBe('client');
  });
  it('idempotent + НЕ затирает birthday (merge)', async () => {
    const u = await mkUser('pt-b@a.test');
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', attributes: { birthday: { day: 5, month: 6 } } } });
    await setType(u, 'Серик', 'partner');
    const e = await prisma.entity.findFirst({ where: { userId: u, name: 'Серик' } });
    const attrs = e?.attributes as Record<string, unknown>;
    expect(attrs.personType).toBe('partner');
    expect(attrs.birthday).toBeTruthy();
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('pt-iso-a@a.test');
    const b = await mkUser('pt-iso-b@a.test');
    await setType(a, 'Бекзат', 'investor');
    expect(await prisma.entity.findFirst({ where: { userId: b, name: 'Бекзат' } })).toBeNull();
  });
});
