import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { aboutMeRoutes } from '../routes/about-me.js';
import { roomRoutes } from '../routes/room.js';
import { friendshipFrom, getFriendship, FRIEND_LEVELS } from './friendship.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([aboutMeRoutes, roomRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user(timezone = 'Asia/Almaty') {
  return (await prisma.user.create({ data: { email: `fr-${Date.now()}-${Math.random()}@a.test`, name: 'Берик Курмангалиев', passwordHash: 'x', timezone } })).id;
}
const auth = (u: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: u })}` });
const say = (userId: string, at: string) => prisma.chatMessage.create({ data: { userId, role: 'user', content: 'привет', createdAt: new Date(at) } });

describe('робот-друг №4: уровень дружбы', () => {
  it('считает дни разговоров по местному времени, дела и дневник', async () => {
    const u = await user();
    // 2026-11-06 20:00 UTC = 7 ноября 01:00 в Алматы → два разных дня, а не один.
    await say(u, '2026-11-06T10:00:00Z');
    await say(u, '2026-11-06T20:00:00Z');
    await say(u, '2026-11-06T21:00:00Z'); // тот же местный день
    await prisma.chatMessage.create({ data: { userId: u, role: 'assistant', content: 'ответ' } }); // ответ робота не считается
    await prisma.task.create({ data: { userId: u, title: 'a', category: 'work', priority: 'low', date: new Date('2026-11-06'), completed: true } });
    await prisma.task.create({ data: { userId: u, title: 'b', category: 'work', priority: 'low', date: new Date('2026-11-06'), completed: false } });
    await prisma.journalEntry.create({ data: { userId: u, date: new Date('2026-11-06'), mood: 7 } });
    const f = await getFriendship(u);
    expect(f.counts).toEqual({ talkDays: 2, tasks: 1, habits: 0, journal: 1 });
    expect(f.points).toBe(2 * 10 + 2 + 3);
    expect(f.level).toBe(1);
    expect(f.next?.title).toBe('Приятели');
  });

  it('уровни по порогам, максимальный — без «следующего»', () => {
    const at = (talkDays: number) => friendshipFrom({ talkDays, tasks: 0, habits: 0, journal: 0 });
    expect(at(5).level).toBe(2);
    expect(at(5).progress).toBe(0);
    expect(at(10).progress).toBe(0.5);
    expect(at(15).title).toBe('Друзья');
    const max = at(500);
    expect(max.level).toBe(FRIEND_LEVELS.length);
    expect(max.next).toBeNull();
    expect(max.unlocks.every((x) => x.unlocked)).toBe(true);
  });

  it('о новом уровне говорит один раз; новичка не поздравляет с первым', async () => {
    const u = await user();
    const first = await app.inject({ method: 'GET', url: '/robot/friendship', headers: auth(u) });
    expect(first.statusCode).toBe(200);
    expect(first.json().levelUp).toBeNull();
    for (let d = 1; d <= 5; d++) await say(u, `2026-10-0${d}T08:00:00Z`);
    const up = (await app.inject({ method: 'GET', url: '/robot/friendship', headers: auth(u) })).json();
    expect(up.level).toBe(2);
    expect(up.levelUp).toContain('Берик, мы стали ближе');
    expect(up.levelUp).toContain('аквариум');
    expect((await app.inject({ method: 'GET', url: '/robot/friendship', headers: auth(u) })).json().levelUp).toBeNull();
  });

  it('подарок дружбы: закрыт до уровня (403), открыт — берётся один раз', async () => {
    const u = await user();
    const take = () => app.inject({ method: 'POST', url: '/room/buy', headers: auth(u), payload: { variantKey: 'friend:aquarium' } });
    const locked = await take();
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error).toContain('«Приятели»');
    for (let d = 1; d <= 5; d++) await say(u, `2026-10-0${d}T08:00:00Z`);
    const ok = await take();
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balance).toBe(0); // бесплатно
    expect((await take()).statusCode).toBe(409);
  });

  it('без входа — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/robot/friendship' })).statusCode).toBe(401);
  });
});
