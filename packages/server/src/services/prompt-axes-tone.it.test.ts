import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const runAgent = vi.fn(async (_o: { system: string }) => 'ответ');
vi.mock('./claude-agent.js', () => ({ runAgent: (o: { system: string }) => runAgent(o) }));
const { handleMessage } = await import('./jarvis-orchestrator.js');

/** Этап 4: оси пользователя и тон бота — функции были, вызовов не было. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('оси и тон в системном промпте', () => {
  it('флаги включены → оба блока в system', async () => {
    process.env.FEATURE_V2_MEMORY = 'all';
    process.env.FEATURE_V2_AXES = 'all';
    process.env.FEATURE_V2_IDENTITY = 'all';
    const userId = (
      await prisma.user.create({ data: { email: `pat-${Date.now()}-${Math.random()}@a.test`, name: 'P', passwordHash: 'x', timezone: 'UTC' } })
    ).id;
    runAgent.mockClear();
    await handleMessage(userId, 'расскажи анекдот про кота');
    const system = runAgent.mock.calls[0][0].system;
    expect(system).toContain('Личностные оси');
    expect(system).toContain('Твоя персона');
    expect(system).toContain('Стиль, который выбрал пользователь, главнее');
  });
});
