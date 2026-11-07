import { describe, it, expect, vi, beforeEach } from 'vitest';

type CreateOpts = { timeout?: number; signal?: AbortSignal } | undefined;
const create = vi.fn<(body: unknown, opts: CreateOpts) => Promise<unknown>>();
vi.mock('../lib/anthropic.js', () => ({
  createAnthropic: () => ({ messages: { create: (b: unknown, o: CreateOpts) => create(b, o) } }),
}));

const { runAgent } = await import('./claude-agent.js');
const { AgentDeadlineError, callBudget, isPastDeadline, deadlineReplyText, MIN_CALL_MS } = await import(
  '../lib/agent-deadline.js'
);
const { AiModelError } = await import('../lib/errors.js');

const textReply = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });

beforeEach(() => create.mockReset());

describe('предел хода: runAgent', () => {
  it('без deadlineAt — как раньше: опций запроса нет', async () => {
    create.mockResolvedValueOnce(textReply('Привет!'));
    expect(await runAgent({ system: 's', userMessage: 'привет', webSearch: false })).toBe('Привет!');
    expect(create.mock.calls[0][1]).toBeUndefined();
  });

  it('с deadlineAt — вызов получает остаток времени и signal (обрывает и повторы SDK)', async () => {
    create.mockResolvedValueOnce(textReply('Ок'));
    await runAgent({ system: 's', userMessage: 'x', webSearch: false, deadlineAt: Date.now() + 20_000 });
    const o = create.mock.calls[0][1];
    expect(o?.timeout).toBeGreaterThan(15_000);
    expect(o?.timeout).toBeLessThanOrEqual(20_000);
    expect(o?.signal).toBeInstanceOf(AbortSignal);
  });

  it('время уже вышло — Claude не зовём, AgentDeadlineError', async () => {
    await expect(
      runAgent({ system: 's', userMessage: 'x', webSearch: false, deadlineAt: Date.now() + 500 }),
    ).rejects.toBeInstanceOf(AgentDeadlineError);
    expect(create).not.toHaveBeenCalled();
  });

  it('вызов оборвался по сроку → AgentDeadlineError, а не AiModelError', async () => {
    const deadlineAt = Date.now() + MIN_CALL_MS + 50;
    create.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, MIN_CALL_MS + 100));
      throw new Error('Request timed out.');
    });
    await expect(runAgent({ system: 's', userMessage: 'x', webSearch: false, deadlineAt })).rejects.toBeInstanceOf(
      AgentDeadlineError,
    );
  }, 10_000);

  it('обычный сбой Claude до срока — по-прежнему AiModelError (запасные пути работают)', async () => {
    create.mockRejectedValueOnce(new Error('overloaded'));
    await expect(
      runAgent({ system: 's', userMessage: 'x', webSearch: false, deadlineAt: Date.now() + 30_000 }),
    ).rejects.toBeInstanceOf(AiModelError);
  });
});

describe('agent-deadline — чистые функции', () => {
  it('callBudget: без срока undefined, мало времени — ошибка', () => {
    expect(callBudget(undefined)).toBeUndefined();
    expect(() => callBudget(1_000 + MIN_CALL_MS - 1, 1_000)).toThrow(AgentDeadlineError);
    expect(callBudget(1_000 + 10_000, 1_000)?.timeout).toBe(10_000);
  });
  it('isPastDeadline', () => {
    expect(isPastDeadline(undefined)).toBe(false);
    expect(isPastDeadline(10_000, 5_000)).toBe(false);
    expect(isPastDeadline(10_000, 9_500)).toBe(true);
  });
  it('честный текст: сделал часть — «не повторяй», ничего — «спроси ещё раз»', () => {
    expect(deadlineReplyText(true)).toMatch(/часть уже сделал/);
    expect(deadlineReplyText(true)).toMatch(/Не повторяй/);
    expect(deadlineReplyText(false)).toMatch(/Спроси ещё раз/);
  });
});
