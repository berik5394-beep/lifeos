import { prisma } from '../lib/prisma.js';
import {
  selectInsights,
  flatInsightToCandidate,
  type FlatInsight,
  type ActiveInsight,
} from './insight-core.js';

/**
 * Phase 5 R5 P4-fold — DB-glue ЕДИНОГО Insight-стора. Вся ЛОГИКА
 * решений (R9 supersede / R10 cooldown / TTL / дедуп) живёт в чистом
 * insight-core (доказана юнит-тестами без БД, паттерн materializeImport:
 * тестируем ядро, БД-склейку доверяем). Здесь — только I/O:
 *  1. flat → кандидаты (адаптер ядра);
 *  2. читаем АКТИВНЫЕ ядро-инсайты (supersededAt=null, не dismissed,
 *     не протухшие; legacy-строки без kind/scopeKey игнорим — не наши);
 *  3. selectInsights решает create/supersede;
 *  4. одна транзакция: supersededAt на старых + createMany новых.
 *
 * Аддитивно: НЕ трогает возвращаемый фид (R5.3). Переключение
 * `GET /insights` на чтение таблицы — отдельный шаг R5.4. Сейчас
 * задача — оживить мёртвую Insight-таблицу писателем с `source`,
 * без регресса существующего поведения.
 */
export async function persistFlatInsights(
  userId: string,
  flat: FlatInsight[],
  now: Date = new Date(),
): Promise<{ created: number; superseded: number }> {
  const candidates = flat.map(flatInsightToCandidate);
  if (candidates.length === 0) return { created: 0, superseded: 0 };

  const rows = await prisma.insight.findMany({
    where: {
      userId,
      supersededAt: null,
      dismissed: false,
      kind: { not: null },
      scopeKey: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      kind: true,
      scopeKey: true,
      severity: true,
      createdAt: true,
    },
  });

  const active: ActiveInsight[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as string,
    scope: r.scopeKey as string,
    severity: r.severity,
    createdAt: r.createdAt,
  }));

  const { create, supersedeIds } = selectInsights(candidates, active, now);
  if (create.length === 0 && supersedeIds.length === 0) {
    return { created: 0, superseded: 0 };
  }

  await prisma.$transaction([
    ...(supersedeIds.length
      ? [
          prisma.insight.updateMany({
            where: { id: { in: supersedeIds } },
            data: { supersededAt: now },
          }),
        ]
      : []),
    ...(create.length
      ? [
          prisma.insight.createMany({
            data: create.map((c) => ({
              userId,
              kind: c.kind,
              scopeKey: c.scope,
              scope: { key: c.scope, kind: c.kind },
              source: c.source,
              severity: c.severity,
              message: c.message,
              rationale: c.rationale ?? null,
              dismissKey: c.dismissKey ?? null,
              expiresAt: c.expiresAt,
              createdAt: now,
            })),
          }),
        ]
      : []),
  ]);

  return { created: create.length, superseded: supersedeIds.length };
}

/**
 * R5.4 — scopeKey активных ядро-инсайтов (lifecycle SSOT для фида).
 * Активный = не superseded, не dismissed, не протух. Пустой Set
 * (легаси-only / персист упал) → joinFeed отдаст computed (резильент).
 */
export async function activeScopeKeys(
  userId: string,
  now: Date = new Date(),
): Promise<Set<string>> {
  const rows = await prisma.insight.findMany({
    where: {
      userId,
      supersededAt: null,
      dismissed: false,
      scopeKey: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { scopeKey: true },
  });
  return new Set(rows.map((r) => r.scopeKey as string));
}
