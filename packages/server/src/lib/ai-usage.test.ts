import { describe, it, expect, beforeEach } from 'vitest';
import { observedFetch } from './observed-fetch.js';
import { pendingUsage, usageContext, usageFromClaudeStream, usageFromClaudeJson, resetUsageBuffer } from './ai-usage.js';
import { resetOpsAlertState } from './ops-alert.js';

const drain = () => new Promise((r) => setTimeout(r, 20));

describe('разбор расхода Claude', () => {
  it('обычный ответ', () => {
    expect(
      usageFromClaudeJson({ model: 'claude-haiku-4-5', usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 1000 } }),
    ).toEqual({ provider: 'claude', model: 'claude-haiku-4-5', inputTokens: 120, outputTokens: 30, cacheReadTokens: 1000, cacheWriteTokens: undefined });
  });
  it('поток: вход из message_start, итоговый выход из message_delta', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":2000,"output_tokens":1,"cache_creation_input_tokens":500}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Привет"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":240}}',
    ].join('\n');
    expect(usageFromClaudeStream(sse)).toMatchObject({ model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 240, cacheWriteTokens: 500 });
  });
});

describe('observedFetch — ответ SDK не меняется, расход и сбои видны', () => {
  beforeEach(() => {
    resetOpsAlertState();
    resetUsageBuffer();
  });

  it('токены записываются на человека из контекста запроса', async () => {
    const base = async () =>
      new Response(JSON.stringify({ model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const f = observedFetch('claude', base);
    const res = await usageContext.run({ userId: 'u-42' }, () => f('https://api.anthropic.com/v1/messages'));
    expect((await res.json()).usage.input_tokens).toBe(10); // SDK получает тело целиком
    await drain();
    const row = pendingUsage().find((r) => r.userId === 'u-42');
    expect(row).toMatchObject({ provider: 'claude', model: 'claude-haiku-4-5', calls: 1, inputTokens: 10, outputTokens: 5 });
  });

  it('без контекста запроса — фоновая работа (system)', async () => {
    const base = async () =>
      new Response(JSON.stringify({ model: 'claude-haiku-4-5', usage: { input_tokens: 7, output_tokens: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await observedFetch('claude', base)('https://api.anthropic.com/v1/messages');
    await drain();
    expect(pendingUsage().find((r) => r.userId === 'system')?.inputTokens).toBe(7);
  });

  it('Whisper — считается вызов', async () => {
    const base = async () => new Response('привет', { status: 200 });
    await usageContext.run({ userId: 'u-1' }, () => observedFetch('groq', base)('https://api.groq.com/openai/v1/audio/transcriptions'));
    await drain();
    expect(pendingUsage().find((r) => r.provider === 'groq')).toMatchObject({ userId: 'u-1', model: 'whisper', calls: 1 });
  });

  it('ошибка провайдера отдаётся SDK как есть (ретраи/сообщения — его дело)', async () => {
    const base = async () => new Response('{"error":{"type":"authentication_error"}}', { status: 401 });
    const res = await observedFetch('groq', base)('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('authentication_error');
  });
});
