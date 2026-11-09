import { prisma } from '../../lib/prisma.js';
import { findDedupTarget, STABLE_TYPES, storeMemoryEmbedding } from '../episodic-memory.js';
import { mergeDetails, shouldOverwriteContent } from '../memory-service.js';

/**
 * Разовая склейка старых дублей памяти (Berik 2026-11-10, «склеить старые дубли»).
 * 2026-11-09 дедуп writeMemory стал двусторонним — новые дубли не плодятся, а
 * накопленные до этого остались. Здесь — те же правила (findDedupTarget) по
 * всем живым записям стабильных типов, от старых к новым: более поздняя запись
 * сливается в более раннюю.
 *
 * Обратимо: дубль НЕ удаляется — он «забывается» (invalidAt, как «Неправда»),
 * его подробности/теги/важность переходят в выжившую запись. Каждая пара — в
 * лог (id → id), вернуть можно restoreMemory. Тексты памяти в лог не пишем.
 *
 * dry — только считает (ничего не меняет); apply — склеивает.
 */
export type BackfillMode = 'dry' | 'apply';

export interface BackfillReport {
  mode: BackfillMode;
  users: number;
  scanned: number;
  merged: number;
  byType: Record<string, number>;
  /** Пары «дубль → выжившая» (только id). */
  pairs: Array<{ userId: string; type: string; from: string; into: string }>;
}

export async function runMemoryDedupeBackfill(mode: BackfillMode, now: Date = new Date()): Promise<BackfillReport> {
  const report: BackfillReport = { mode, users: 0, scanned: 0, merged: 0, byType: {}, pairs: [] };
  const types = [...STABLE_TYPES];
  const alive = { OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] };
  const users = await prisma.memory.findMany({
    where: { type: { in: types }, ...alive },
    select: { userId: true },
    distinct: ['userId'],
  });
  report.users = users.length;

  for (const { userId } of users) {
    for (const type of types) {
      const rows = await prisma.memory.findMany({
        where: { userId, type, ...alive },
        orderBy: { createdAt: 'asc' },
        select: { id: true, content: true, details: true, tags: true, importance: true, createdAt: true },
      });
      // dry: «склеенные» в базе остаются живыми — выжившая для цепочки = её корень.
      const mergedInto = new Map<string, string>();
      for (const row of rows) {
        report.scanned++;
        const target = await findDedupTarget(userId, type, row.content, { excludeId: row.id, before: row.createdAt });
        if (!target) continue;
        let into = target.id;
        while (mergedInto.has(into)) into = mergedInto.get(into) as string;
        if (into === row.id) continue;
        mergedInto.set(row.id, into);
        report.merged++;
        report.byType[type] = (report.byType[type] ?? 0) + 1;
        report.pairs.push({ userId, type, from: row.id, into });
        if (mode === 'apply') await mergeRow(row, into, type, now);
      }
    }
  }
  return report;
}

async function mergeRow(
  row: { id: string; content: string; details: string | null; tags: string[]; importance: number },
  intoId: string,
  type: string,
  now: Date,
): Promise<void> {
  const into = await prisma.memory.findUnique({
    where: { id: intoId },
    select: { content: true, details: true, tags: true, importance: true },
  });
  if (!into) return;
  // Как в writeMemory: более подробная формулировка заменяет бедную, не наоборот.
  const content = shouldOverwriteContent(into.content, row.content) ? row.content : into.content;
  const details = mergeDetails(into.details, row.details);
  const tags = Array.from(new Set([...(into.tags || []), ...(row.tags || [])])).slice(0, 10);
  const importance = Math.max(into.importance, row.importance);
  await prisma.$transaction([
    prisma.memory.update({ where: { id: intoId }, data: { content, details, tags, importance } }),
    prisma.memory.update({ where: { id: row.id }, data: { invalidAt: now } }),
  ]);
  if (content !== into.content || details !== into.details) {
    await storeMemoryEmbedding(intoId, content, details, { type, content });
  }
}

/** Одна строка в лог: счётчики и пары id (без текстов памяти). */
export function backfillLogLine(r: BackfillReport): string {
  const types = Object.entries(r.byType).map(([t, n]) => `${t}:${n}`).join(',') || '—';
  return `[memory-dedupe] mode=${r.mode} users=${r.users} scanned=${r.scanned} merged=${r.merged} byType=${types}`;
}
