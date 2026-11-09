import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getRecentHistory } from './jarvis-orchestrator.js';

/**
 * «Робот отстаёт на ход» (живой прогон 2026-11-10): вопрос и ответ одного хода
 * лежали с одинаковым временем, порядок внутри пары был случайным — ответ
 * вставал раньше вопроса, модель видела прошлый вопрос последним.
 */
describe('история чата — вопрос всегда раньше ответа', () => {
  it('пары с одинаковым временем читаются «вопрос → ответ», последний — текущий ход', async () => {
    const u = await prisma.user.create({ data: { email: `ord-${Date.now()}@t.io`, name: 'О', passwordHash: 'x' } });
    const t = (s: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, s));
    // Вставляем ответ ПЕРВЫМ — как случайный порядок при равном времени.
    await prisma.chatMessage.createMany({
      data: [
        { userId: u.id, role: 'assistant', content: 'О1', createdAt: t(1) },
        { userId: u.id, role: 'user', content: 'В1', createdAt: t(1) },
        { userId: u.id, role: 'assistant', content: 'О2', createdAt: t(2) },
        { userId: u.id, role: 'user', content: 'В2', createdAt: t(2) },
      ],
    });
    const h = await getRecentHistory(u.id, 6);
    expect(h.map((m) => m.content)).toEqual(['В1', 'О1', 'В2', 'О2']);
    expect(h.at(-1)?.role).toBe('assistant');
  });
});
