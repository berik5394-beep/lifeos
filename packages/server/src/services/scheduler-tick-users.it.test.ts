import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { selectTickUsers } from './proactive-scheduler.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const stamp = Date.now();
async function mkUser(tag: string, token: string | null = null) {
  const u = await prisma.user.create({
    data: { email: `tick-${tag}-${stamp}@a.test`, name: 'TK', passwordHash: 'x', timezone: 'Asia/Almaty', expoPushToken: token },
  });
  return u.id;
}

// Отказ в пушах не должен выключать проактивность навсегда: активный юзер
// без канала обрабатывается тиком (нудж придёт облачком в приложении).
describe('selectTickUsers', () => {
  it('пуш-юзер — с каналом; активный без пушей — без канала; спящий без пушей — не берётся', async () => {
    const pushed = await mkUser('push', `ExponentPushToken[t-${stamp}]`);
    const chatty = await mkUser('chatty');
    const tasker = await mkUser('tasker');
    const sleepy = await mkUser('sleepy');
    await prisma.chatMessage.create({ data: { userId: chatty, role: 'user', content: 'привет' } });
    await prisma.task.create({ data: { userId: tasker, title: 'купить хлеб', category: 'home', priority: 'low', date: new Date() } });
    const old = new Date(Date.now() - 30 * 86_400_000);
    await prisma.chatMessage.create({ data: { userId: sleepy, role: 'user', content: 'давно', createdAt: old } });

    const users = await selectTickUsers(new Date());
    const by = new Map(users.map((u) => [u.id, u.hasChannel]));
    expect(by.get(pushed)).toBe(true);
    expect(by.get(chatty)).toBe(false);
    expect(by.get(tasker)).toBe(false);
    expect(by.has(sleepy)).toBe(false);
    expect(users.filter((u) => u.id === pushed)).toHaveLength(1);
  });
});
