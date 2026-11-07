import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const runAgent = vi.fn(async (_opts: { system?: string; onText?: (d: string) => void }) => 'ответ');
vi.mock('./claude-agent.js', () => ({ runAgent: (o: { system?: string; onText?: (d: string) => void }) => runAgent(o) }));
const { handleMessage } = await import('./jarvis-orchestrator.js');

/**
 * «Ускорить начало» (jarvis-roadmap №5): в голосе контекст собирается
 * одновременно с разбором намерения; дополнения промпта — параллельно.
 * Поведение то же: быстрые команды — без агента, обычный ответ — с контекстом.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const user = async () =>
  (await prisma.user.create({ data: { email: `vf-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC' } })).id;

describe('голос: быстрый старт', () => {
  it('быстрая команда (задача) — без агента, как раньше', async () => {
    runAgent.mockClear();
    const u = await user();
    const r = await handleMessage(u, 'создай задачу купить хлеб на завтра', 'voice');
    expect(runAgent).not.toHaveBeenCalled();
    expect(await prisma.task.count({ where: { userId: u, title: { contains: 'хлеб', mode: 'insensitive' } } })).toBe(1);
    expect(r.reply).toBeTruthy();
  });

  it('обычный вопрос — агент получает собранный контекст (имя), кусками и строкой времени в логе', async () => {
    runAgent.mockReset();
    runAgent.mockImplementationOnce(async (o) => {
      o.onText?.('Привет, ');
      o.onText?.('Берик!');
      return 'Привет, Берик!';
    });
    const log = vi.spyOn(console, 'log');
    const parts: string[] = [];
    const u = await user();
    const r = await handleMessage(u, 'расскажи анекдот про кота', 'voice', { onText: (d) => parts.push(d) });
    expect(r.reply).toBe('Привет, Берик!');
    expect(parts).toEqual(['Привет, ', 'Берик!']);
    expect(String(runAgent.mock.calls[0][0].system)).toContain('Берик');
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[jarvis:timing]'));
    expect(line).toMatch(/intent=\d+ ctx=\d+ prep=\d+ first=\d+ total=\d+ user=\S+ ch=voice/);
    log.mockRestore();
  });
});
