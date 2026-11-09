import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from './prisma.js';

/**
 * Счётчик расхода моделей (Berik 2026-11-09: «посчитать стоимость одного
 * пользователя в день до запуска»). Каждый ответ Claude/Groq проходит через
 * observedFetch (lib/anthropic.ts, lib/groq.ts) → токены копятся в памяти по
 * (день, человек, провайдер, модель) и раз в минуту сбрасываются в AiUsageDay.
 *
 * Человек — из контекста запроса (onRequest кладёт хранилище, authMiddleware
 * пишет userId). Фоновая работа (планировщик, кроны) — 'system'.
 */

export interface UsageStore {
  userId?: string;
}

export const usageContext = new AsyncLocalStorage<UsageStore>();

/** Fastify onRequest: хранилище на весь запрос (паттерн @fastify/request-context). */
export function usageContextHook(_req: unknown, _reply: unknown, done: () => void): void {
  usageContext.run({}, done);
}

/** authMiddleware: запрос принадлежит этому человеку. */
export function setUsageUser(userId: string): void {
  const store = usageContext.getStore();
  if (store) store.userId = userId;
}

export const SYSTEM_USER = 'system';

export interface UsageDelta {
  provider: 'claude' | 'groq';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface Bucket {
  day: string;
  userId: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const buffer = new Map<string, Bucket>();

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function recordUsage(d: UsageDelta, now: Date = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  const userId = usageContext.getStore()?.userId ?? SYSTEM_USER;
  const model = (d.model || 'unknown').slice(0, 64);
  const key = `${day}|${userId}|${d.provider}|${model}`;
  const b = buffer.get(key) ?? {
    day, userId, provider: d.provider, model,
    calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  };
  b.calls += 1;
  b.inputTokens += n(d.inputTokens);
  b.outputTokens += n(d.outputTokens);
  b.cacheReadTokens += n(d.cacheReadTokens);
  b.cacheWriteTokens += n(d.cacheWriteTokens);
  buffer.set(key, b);
}

/** Для тестов: очистить буфер без записи. */
export function resetUsageBuffer(): void {
  buffer.clear();
}

/** Для тестов: что накопилось и ещё не записано. */
export function pendingUsage(): Bucket[] {
  return [...buffer.values()].map((b) => ({ ...b }));
}

export async function flushUsage(): Promise<number> {
  if (buffer.size === 0) return 0;
  const rows = [...buffer.values()];
  buffer.clear();
  let written = 0;
  for (const r of rows) {
    try {
      await prisma.aiUsageDay.upsert({
        where: { day_userId_provider_model: { day: new Date(r.day), userId: r.userId, provider: r.provider, model: r.model } },
        create: { ...r, day: new Date(r.day) },
        update: {
          calls: { increment: r.calls },
          inputTokens: { increment: r.inputTokens },
          outputTokens: { increment: r.outputTokens },
          cacheReadTokens: { increment: r.cacheReadTokens },
          cacheWriteTokens: { increment: r.cacheWriteTokens },
        },
      });
      written++;
    } catch (err) {
      console.warn('[ai-usage] flush failed:', err instanceof Error ? err.message : err);
    }
  }
  return written;
}

let timer: NodeJS.Timeout | null = null;
export function startUsageFlusher(): void {
  if (timer) return;
  timer = setInterval(() => void flushUsage(), 60_000);
  timer.unref?.();
}

// ── разбор ответов провайдера ────────────────────────────────────────────

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function fromClaudeUsage(model: string, u: ClaudeUsage | undefined): UsageDelta {
  return {
    provider: 'claude',
    model,
    inputTokens: u?.input_tokens,
    outputTokens: u?.output_tokens,
    cacheReadTokens: u?.cache_read_input_tokens,
    cacheWriteTokens: u?.cache_creation_input_tokens,
  };
}

/** Обычный JSON-ответ /v1/messages. */
export function usageFromClaudeJson(body: unknown): UsageDelta | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { model?: string; usage?: ClaudeUsage; type?: string };
  if (!b.usage) return null;
  return fromClaudeUsage(b.model ?? 'unknown', b.usage);
}

/** Поток (SSE): input — в message_start, итоговый output — в message_delta. */
export function usageFromClaudeStream(sse: string): UsageDelta | null {
  let model = 'unknown';
  let usage: ClaudeUsage | undefined;
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let ev: { type?: string; message?: { model?: string; usage?: ClaudeUsage }; usage?: ClaudeUsage };
    try {
      ev = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (ev.type === 'message_start' && ev.message) {
      model = ev.message.model ?? model;
      usage = { ...ev.message.usage };
    } else if (ev.type === 'message_delta' && ev.usage) {
      usage = { ...(usage ?? {}), ...ev.usage };
    }
  }
  return usage ? fromClaudeUsage(model, usage) : null;
}
