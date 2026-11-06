import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Агент-цикл (модель) замокан: проверяем, что промах привычки уходит агенту с инструментами.
const runAgent = vi.fn(async (_opts: { localTools?: boolean }) => 'ответ робота');
vi.mock('./claude-agent.js', () => ({ runAgent: (opts: { localTools?: boolean }) => runAgent(opts) }));
const { handleMessage } = await import('./jarvis-orchestrator.js');

/**
 * Этап 0: «сделал отчёт» регекс принимает за привычку «отчёт». Нет ни привычки,
 * ни задачи — раньше тупик «Не получилось выполнить». Теперь — агент с инструментами.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user(tag: string) {
  return (
    await prisma.user.create({
      data: { email: `hmf-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'UTC' },
    })
  ).id;
}

describe('промах complete_habit → агент', () => {
  it('«сделал отчёт» без привычки и задачи → агент с инструментами, не тупик', async () => {
    const userId = await user('miss');
    runAgent.mockClear();
    const r = await handleMessage(userId, 'сделал отчёт для Серика');
    expect(r.reply).toBe('ответ робота');
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0][0].localTools).toBe(true);
    expect(await prisma.habitLog.count({ where: { userId } })).toBe(0);
  });

  it('привычка есть → отмечается сразу, без агента', async () => {
    const userId = await user('hit');
    await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    runAgent.mockClear();
    const r = await handleMessage(userId, 'сделал зарядку');
    expect(runAgent).not.toHaveBeenCalled();
    expect(r.intent).toBe('complete_habit');
    expect(r.reply).toMatch(/Зарядка/);
    expect(await prisma.habitLog.count({ where: { userId, completed: true } })).toBe(1);
  });
});
