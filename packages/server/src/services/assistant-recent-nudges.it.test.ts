import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherAssistantContext } from './assistant-service.js';

/** Чат видит, что робот сам недавно подсказал; смахнутое и старое — нет. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('контекст чата: недавние подсказки робота', () => {
  it('свежая — есть; смахнутая и трёхдневная — нет', async () => {
    const userId = (
      await prisma.user.create({ data: { email: `rn-${Date.now()}-${Math.random()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } })
    ).id;
    const row = (message: string, extra: Record<string, unknown> = {}) =>
      prisma.insight.create({ data: { userId, kind: 'v2_nudge', scopeKey: `t:${message}`, scope: {}, source: 'v2-proactivity', severity: 6, message, ...extra } });
    await row('Свежая подсказка');
    await row('Смахнутая', { dismissed: true });
    await row('Старая', { createdAt: new Date(Date.now() - 3 * 86_400_000) });
    const g = await gatherAssistantContext(userId, '', { action: 'ask_assistant' });
    expect(g?.context.recentNudges).toEqual(['Свежая подсказка']);
  });
});
