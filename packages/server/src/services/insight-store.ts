import { prisma } from '../lib/prisma.js';
import {
  selectInsights,
  flatInsightToCandidate,
  chooseInsightToPush,
  severityBand,
  type FlatInsight,
  type ActiveInsight,
  type InsightCandidate,
} from './insight-core.js';
import { localHour, localDayStartUTC } from '../lib/tz.js';
import { deliverNotification } from './push-service.js';
import { getEngagement, isReceptiveHour } from './engagement/index.js';
import { isV2EngagementEnabled } from '../lib/feature-flags.js';

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
  return persistCandidates(userId, flat.map(flatInsightToCandidate), now);
}

/**
 * P3.b.2 — ОБЩИЙ путь персиста кандидатов в ЕДИНЫЙ стор (R5).
 * Плоский движок (persistFlatInsights) и рефлектор (P3.b) льют
 * сюда же → один selectInsights (R9/R10/dedup/TTL), один провенанс
 * `source`. Решения — чистое ядро; здесь только I/O-транзакция.
 */
export async function persistCandidates(
  userId: string,
  candidates: InsightCandidate[],
  now: Date = new Date(),
): Promise<{ created: number; superseded: number }> {
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

/**
 * P3.b.5 — активные ряды стора для ленты (гибрид R5.4). Те, у кого
 * НЕТ compute-близнеца (рефлектор), рендерятся из своего payload
 * (tableOnlyFeed). Активный = не superseded/dismissed/expired.
 */
export async function activeRowsForFeed(
  userId: string,
  now: Date = new Date(),
): Promise<
  Array<{ scopeKey: string; severity: number; message: string; dismissKey: string | null }>
> {
  const rows = await prisma.insight.findMany({
    where: {
      userId,
      supersededAt: null,
      dismissed: false,
      scopeKey: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      scopeKey: true,
      severity: true,
      message: true,
      dismissKey: true,
    },
    orderBy: { severity: 'desc' },
  });
  return rows.map((r) => ({
    scopeKey: r.scopeKey as string,
    severity: r.severity,
    message: r.message,
    dismissKey: r.dismissKey,
  }));
}

/**
 * R6 — доставить РОВНО один инсайт пушем (≤1/день, top-severity,
 * вне тихих часов R11). DB/tz-glue; решение — чистое
 * chooseInsightToPush. tz-КОРРЕКТНО: локальный час и «доставлено
 * сегодня» считаются по User.timezone через lib/tz (НЕ серверный
 * UTC — W11 был реальным tz-багом). R9/R10 уже применены на
 * создании (persistFlatInsights), сюда — только живые недоставленные.
 * Идемпотентно по дню: deliveredAt today → больше не пушим.
 */
export async function deliverTopInsight(
  userId: string,
  now: Date = new Date(),
): Promise<{ deliveredId: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, wakeUpTime: true },
  });
  if (!user) return { deliveredId: null };

  const tz = user.timezone;
  const hour = localHour(tz, now);
  const wakeUpHour = Number(String(user.wakeUpTime).split(':')[0]) || 7;
  const dayStart = localDayStartUTC(tz, now);

  const [deliveredToday, undelivered] = await Promise.all([
    prisma.insight.count({
      where: { userId, deliveredAt: { gte: dayStart } },
    }),
    prisma.insight.findMany({
      where: {
        userId,
        deliveredAt: null,
        supersededAt: null,
        dismissed: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        severity: true,
        createdAt: true,
        message: true,
        rationale: true,
      },
    }),
  ]);

  const chosen = chooseInsightToPush(
    undelivered.map((r) => ({
      id: r.id,
      severity: r.severity,
      createdAt: r.createdAt,
    })),
    hour,
    wakeUpHour,
    deliveredToday > 0,
  );
  if (!chosen) return { deliveredId: null };

  const row = undelivered.find((r) => r.id === chosen.id)!;

  // v2 P2 — engagement: defer NON-critical delivery outside the user's
  // active hours. Critical (severity>=8) always delivers. Best-effort; on
  // any failure or sparse data, isReceptiveHour returns true → no deferral.
  if (isV2EngagementEnabled(userId) && severityBand(row.severity) !== 'critical') {
    try {
      const eng = await getEngagement(userId, now);
      if (!isReceptiveHour(eng.activeHours, hour)) {
        return { deliveredId: null }; // defer; next tick retries (deliveredAt stays null)
      }
    } catch (err) {
      console.warn('[engagement:deliver] failed:', err);
    }
  }

  const res = await deliverNotification(
    userId,
    // Юзеру — ТОЛЬКО текст инсайта. Внутренний rationale (напр.
    // 'v2-proactivity:skill_suggestion') НЕ показываем как заголовок —
    // он просачивался в сообщение. Провенанс остаётся в БД (row.rationale).
    '',
    row.message,
    { type: 'insight', insightId: row.id },
  );
  if (!res.push && !res.telegram) return { deliveredId: null };

  // Доставлено → метим deliveredAt (≤1/день держится этим полем).
  await prisma.insight
    .update({ where: { id: row.id }, data: { deliveredAt: now } })
    .catch(() => {});
  return { deliveredId: row.id };
}
