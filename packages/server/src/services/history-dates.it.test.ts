import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRecentHistory } from './jarvis-orchestrator.js';

/**
 * Berik 2026-11-10: «завтра», написанное позавчера, — уже не «завтра». Сообщения
 * человека прошлых дней приходят мозгу с пометкой «написано N — позавчера».
 */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const H = 3_600_000;

describe('история разговора с датами', () => {
  it('старые сообщения человека — с пометкой дня; сегодняшние и ответы робота — как есть', async () => {
    const u = (await prisma.user.create({ data: { email: `hd-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'Asia/Almaty' } })).id;
    const now = Date.now();
    await prisma.chatMessage.createMany({
      data: [
        { userId: u, role: 'user', content: 'Завтра у меня собеседование', createdAt: new Date(now - 48 * H) },
        { userId: u, role: 'assistant', content: 'Удачи завтра!', createdAt: new Date(now - 48 * H + 1) },
        { userId: u, role: 'user', content: 'Привет', createdAt: new Date(now - 60_000) },
      ],
    });
    const h = await getRecentHistory(u, 6);
    expect(h[0].content).toMatch(/^\(написано \d{1,2} [а-я]+ — позавчера\) Завтра у меня собеседование$/);
    expect(h[1].content).toBe('Удачи завтра!');
    expect(h[2].content).toBe('Привет');
  });
});
