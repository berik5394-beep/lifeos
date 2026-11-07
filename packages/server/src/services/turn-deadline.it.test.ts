import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AgentDeadlineError, deadlineReplyText } from '../lib/agent-deadline.js';

const runAgent = vi.fn(async (_opts: { localTools?: boolean; deadlineAt?: number }) => 'ответ');
vi.mock('./claude-agent.js', () => ({
  runAgent: (opts: { localTools?: boolean; deadlineAt?: number }) => runAgent(opts),
}));
const getAssistantReply = vi.fn(async () => ({ text: 'запасной ответ' }));
vi.mock('./assistant-service.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getAssistantReply: () => getAssistantReply(),
}));
const { handleMessage } = await import('./jarvis-orchestrator.js');

/**
 * Ход робота не висит минутами: срок вышел → честный ответ, без запасных
 * путей (каждый — ещё вызовы Claude по 60 с).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const user = async () =>
  (
    await prisma.user.create({
      data: { email: `td-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' },
    })
  ).id;

describe('предел хода в оркестраторе', () => {
  it('агент передаёт срок ~48 с от начала хода', async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Кот зашёл в бар…');
    const before = Date.now();
    await handleMessage(await user(), 'расскажи анекдот про кота');
    const d = runAgent.mock.calls[0][0].deadlineAt ?? 0;
    expect(d - before).toBeGreaterThan(40_000);
    expect(d - before).toBeLessThanOrEqual(48_000 + 5_000);
  });

  it('срок вышел → честное «не успел», без повторов и запасного ответа', async () => {
    runAgent.mockReset();
    getAssistantReply.mockClear();
    runAgent.mockRejectedValueOnce(new AgentDeadlineError());
    const r = await handleMessage(await user(), 'расскажи анекдот про кота');
    expect(r.reply).toBe(deadlineReplyText(false));
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(getAssistantReply).not.toHaveBeenCalled();
  });

  it('обычный сбой агента — запасной путь как раньше', async () => {
    runAgent.mockReset();
    runAgent.mockRejectedValueOnce(new Error('overloaded')).mockResolvedValueOnce('ответ без инструментов');
    const r = await handleMessage(await user(), 'расскажи анекдот про кота');
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(r.reply).toContain('ответ без инструментов');
  });
});
