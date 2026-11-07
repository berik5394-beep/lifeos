import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const runAgent = vi.fn(async (_opts: unknown) => 'ответ');
vi.mock('./claude-agent.js', () => ({ runAgent: (opts: unknown) => runAgent(opts) }));
const { handleMessage } = await import('./jarvis-orchestrator.js');

/** Замер: выдуманное число о делах пользователя в ответе чата попадает в лог, ответ не меняется. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const user = async () =>
  (await prisma.user.create({ data: { email: `ng-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } })).id;
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('[numguard] в чате', () => {
  it('выдуманная сумма → лог, ответ как есть', async () => {
    const warn = vi.spyOn(console, 'warn');
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Осталось 15 731 ₸ до конца месяца, держись!');
    const r = await handleMessage(await user(), 'расскажи анекдот про кота');
    await settle();
    expect(r.reply).toBe('Осталось 15 731 ₸ до конца месяца, держись!');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[numguard]') && String(c[0]).includes('15731'))).toBe(true);
    warn.mockRestore();
  });

  it('число из слов пользователя — не в логе', async () => {
    const warn = vi.spyOn(console, 'warn');
    runAgent.mockReset();
    runAgent.mockResolvedValueOnce('Понял, 4 815 ₸ — это немало.');
    await handleMessage(await user(), 'я вчера отдал 4815 тенге за ерунду, как думаешь много?');
    await settle();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[numguard]'))).toBe(false);
    warn.mockRestore();
  });
});
