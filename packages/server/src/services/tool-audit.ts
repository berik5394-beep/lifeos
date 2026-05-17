import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * SSOT migration Step 1 — единый аудит исполненных инструментов.
 *
 * КАЖДЫЙ реально выполненный tool проходит через auditToolCall и
 * пишет ровно одну строку в ToolCall. Это единственный источник
 * правды на вопрос «вызвался ли tool на самом деле»: бейджи и
 * honesty-тесты читают агрегаты ОТСЮДА, никогда из текста модели.
 *
 * Инвариант: слой аудита НИКОГДА не бросает сам и НИКОГДА не меняет
 * результат/исключение хендлера. Сбой записи аудита логируется, но
 * не ломает действие пользователя.
 */

export interface ToolCallRecord {
  userId: string;
  toolName: string;
  inputJson: unknown;
  outputJson: unknown;
  durationMs: number;
  error: string | null;
}

export type AuditSink = (rec: ToolCallRecord) => Promise<void>;

const toJson = (v: unknown): Prisma.InputJsonValue =>
  (v === undefined ? null : v) as Prisma.InputJsonValue;

const prismaSink: AuditSink = async (rec) => {
  await prisma.toolCall.create({
    data: {
      userId: rec.userId,
      toolName: rec.toolName,
      inputJson: toJson(rec.inputJson),
      outputJson:
        rec.outputJson === undefined || rec.outputJson === null
          ? Prisma.JsonNull
          : toJson(rec.outputJson),
      durationMs: rec.durationMs,
      error: rec.error,
    },
  });
};

async function safeSink(sink: AuditSink, rec: ToolCallRecord): Promise<void> {
  try {
    await sink(rec);
  } catch (e) {
    // Аудит — best-effort. Падение записи НЕ ломает действие юзера,
    // но обязано быть видимым (иначе вернётся «молчаливый дрейф»).
    console.warn(
      `[tool-audit] sink failed tool=${rec.toolName} user=${rec.userId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Оборачивает хендлер инструмента: засекает время, пишет РОВНО одну
 * строку ToolCall (успех ИЛИ ошибка), не бросает из слоя аудита,
 * пробрасывает исходную ошибку хендлера дальше без изменений.
 */
export async function auditToolCall<T>(
  userId: string,
  toolName: string,
  input: unknown,
  handler: () => Promise<T>,
  sink: AuditSink = prismaSink,
): Promise<T> {
  const start = Date.now();
  try {
    const out = await handler();
    await safeSink(sink, {
      userId,
      toolName,
      inputJson: input,
      outputJson: out,
      durationMs: Date.now() - start,
      error: null,
    });
    return out;
  } catch (err) {
    await safeSink(sink, {
      userId,
      toolName,
      inputJson: input,
      outputJson: null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export interface ToolCountRow {
  toolName: string;
  count: number;
}

/**
 * Агрегаты для бейджей мобилы. Считаем ТОЛЬКО успешные вызовы
 * (error = null) — упавший tool не должен рисовать «+1 в задачи».
 */
export async function getToolCounts(
  userId: string,
  since: Date,
): Promise<ToolCountRow[]> {
  const grouped = await prisma.toolCall.groupBy({
    by: ['toolName'],
    where: { userId, createdAt: { gte: since }, error: null },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({ toolName: g.toolName, count: g._count._all }))
    .sort((a, b) => b.count - a.count);
}
