import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import { reflect, type ReflectorFacts } from './reflector-core.js';
import { persistCandidates } from './insight-store.js';
import { planVsFact } from './plan-vs-fact.js';
import { localDayStartUTC } from '../lib/tz.js';
import { isV2SavingsCoachEnabled } from '../lib/feature-flags.js';
import { pickCoachableGoal } from './savings-pace.js';
import type { InsightCandidate } from './insight-core.js';

/**
 * Phase 5 P3.b.3 — рефлектор-сервис (glue). Решения Берика:
 *  - детерминизм РЕШАЕТ (reflect, P3.b.1) — числа из БД;
 *  - Sonnet 1×/день ТОЛЬКО перефразирует message в стиль ассистента,
 *    НЕ меняя цифры/факты (честность by construction);
 *  - де-хардкод 35M → реальная финансовая YearlyGoal.target юзера
 *    (нет цели — НЕ выдумываем горизонт, reflect сам молчит);
 *  - фокусный data-layer (не 779-строчный gatherAllUserData — это
 *    дорого/связно; здесь ровно те цифры, что нужны ядру).
 * Каденс (1/день/юзер) и НЕ-фатальность — на стороне scheduler.
 */

const WINDOW_DAYS = 90;
const WINDOW_MONTHS = 3;
const FIN_RE = /financ|финанс/i;

export async function gatherReflectorFacts(
  userId: string,
  now: Date,
): Promise<ReflectorFacts> {
  const year = now.getFullYear();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const yearStart = new Date(year, 0, 1);

  const [incAgg, expAgg, incYtd, expYtd, goals, planWeeks] = await Promise.all([
    prisma.income.aggregate({
      where: { userId, date: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.income.aggregate({
      where: { userId, date: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.yearlyGoal.findMany({
      where: { userId, year },
      select: {
        id: true,
        area: true,
        goalText: true,
        progress: true,
        target: true,
        targetDate: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.weeklyGoal
      .groupBy({
        by: ['planParentId'],
        where: { userId, derivedFrom: 'planner', archivedAt: null },
        _count: { _all: true },
        _max: { createdAt: true },
      })
      .catch(
        () =>
          [] as Array<{
            planParentId: string | null;
            _count: { _all: number };
            _max: { createdAt: Date | null };
          }>,
      ),
  ]);

  const monthlyIncome = (incAgg._sum.amount ?? 0) / WINDOW_MONTHS;
  const monthlyBurn = (expAgg._sum.amount ?? 0) / WINDOW_MONTHS;

  // Коуч: среди ВСЕХ фин-целей с числом берём ту, что НЕ достигнута и
  // ближе по сроку (с несколькими целями find брал первую — могла быть
  // уже достигнутая → коуч молчал на отстающей; живой баг 2026-06-02).
  // savedSoFar считаем per-goal: доход−расход с floor(createdAt) — короткая
  // «100к за месяц» иначе читается как выполненная из годового профицита.
  const finCandidates = await Promise.all(
    goals
      .filter((g) => FIN_RE.test(g.area) && g.target != null)
      .map(async (g) => {
        const c = g.createdAt;
        const since = new Date(
          Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()),
        );
        const [incG, expG] = await Promise.all([
          prisma.income.aggregate({
            where: { userId, date: { gte: since } },
            _sum: { amount: true },
          }),
          prisma.expense.aggregate({
            where: { userId, date: { gte: since } },
            _sum: { amount: true },
          }),
        ]);
        return {
          goal: g,
          target: g.target as number,
          targetDate: g.targetDate ?? new Date(year, 11, 31),
          saved: (incG._sum.amount ?? 0) - (expG._sum.amount ?? 0),
        };
      }),
  );
  const chosen = pickCoachableGoal(finCandidates);
  const finGoal = chosen?.goal ?? null;
  const savedSoFar = chosen
    ? chosen.saved
    : (incYtd._sum.amount ?? 0) - (expYtd._sum.amount ?? 0);

  const weeksByGoal = new Map<string, number>();
  const builtByGoal = new Map<string, Date>();
  for (const r of planWeeks) {
    if (r.planParentId) {
      weeksByGoal.set(r.planParentId, r._count._all);
      if (r._max.createdAt) builtByGoal.set(r.planParentId, r._max.createdAt);
    }
  }

  const { goals: goalVerdicts } = planVsFact(
    goals.map((g) => ({
      area: g.area,
      goalText: g.goalText,
      progress: g.progress,
      updatedAt: g.updatedAt,
      planBuiltAt: builtByGoal.get(g.id) ?? null,
      planWeeks: weeksByGoal.get(g.id) ?? 0,
    })),
    now,
  );

  return {
    monthlyIncome,
    monthlyBurn,
    // Portfolio-коуч: ВСЕ незакрытые фин-цели (каждая со своим saved от
    // floor(createdAt)). Одиночные поля ниже — для off-пути.
    financeGoals: finCandidates.map((c) => ({
      text: c.goal.goalText,
      target: c.target,
      targetDate: c.targetDate,
      saved: c.saved,
    })),
    financeGoalTarget: finGoal?.target ?? null,
    financeGoalText: finGoal?.goalText ?? null,
    goalVerdicts,
    savedSoFar,
    // Срок: из фин-цели или дефолт 31 дек текущего года.
    targetDate: finGoal?.targetDate ?? new Date(year, 11, 31),
    pacingEnabled: isV2SavingsCoachEnabled(userId),
    now,
  };
}

/**
 * Best-effort перефразировка под стиль ассистента. КРИТИЧНО для
 * честности: цифры/факты НЕ меняем (промпт явно запрещает; на любой
 * сбой/несовпадение длины — оставляем детерминированный текст,
 * который УЖЕ честен). Один Sonnet-вызов на весь батч.
 */
async function phrase(
  candidates: InsightCandidate[],
  style: string,
): Promise<InsightCandidate[]> {
  // FIX (P6-safety 2026-05-28): CLAUDE_API_KEY (см. .env.example).
  // Раньше Phase 5 reflector Sonnet-phrasing молча отключён в проде —
  // инсайты доставлялись только с детерм. ядра (без friend-tone).
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || candidates.length === 0) return candidates;

  const system =
    `Ты — LifeOS-ассистент, стиль «${style}». Перепиши каждое ` +
    `сообщение в этом стиле, КОРОТКО (1-3 предложения), на русском. ` +
    `СТРОГО запрещено менять или выдумывать числа, суммы, проценты, ` +
    `сроки — они уже точные (из БД). Только тон/формулировка. Верни ` +
    `ТОЛЬКО JSON-массив строк той же длины и порядка, без обёрток.`;
  const user = JSON.stringify(candidates.map((c) => c.message));

  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return candidates;
    const arr = JSON.parse(block.text) as unknown;
    if (
      !Array.isArray(arr) ||
      arr.length !== candidates.length ||
      !arr.every((x) => typeof x === 'string' && x.length > 0)
    ) {
      return candidates; // honest fallback — детерминированный текст
    }
    return candidates.map((c, i) => ({ ...c, message: arr[i] as string }));
  } catch (err) {
    console.warn(
      '[reflector] phrase failed (non-fatal, keep deterministic):',
      err instanceof Error ? err.message : err,
    );
    return candidates;
  }
}

/**
 * Один прогон рефлектора для юзера: факты → детерминированные
 * кандидаты → (best-effort) стиль → ЕДИНЫЙ стор (R5: dedup/R9/R10/
 * source='reflector'). Возвращает счётчики персиста.
 */
export async function runReflector(
  userId: string,
  now: Date = new Date(),
): Promise<{ created: number; superseded: number }> {
  const facts = await gatherReflectorFacts(userId, now);
  const candidates = reflect(facts);
  if (candidates.length === 0) return { created: 0, superseded: 0 };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { assistantStyle: true },
  });
  const phrased = await phrase(candidates, user?.assistantStyle ?? 'friendly');
  return persistCandidates(userId, phrased, now);
}

/**
 * P3.b.4 — каденс 1×/день/юзер. tz-КОРРЕКТНО: «сегодня» = локальный
 * день юзера (User.timezone, lib/tz — НЕ серверный UTC, W11-урок).
 * Идемпотентно: уже есть reflector-инсайт за локальные сутки →
 * пропускаем (Sonnet не дёргаем — экономия). Дёшево: один count
 * до любого Claude-вызова.
 */
export async function runReflectorDaily(
  userId: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; created: number; superseded: number }> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const dayStart = localDayStartUTC(u?.timezone ?? 'UTC', now);
  const already = await prisma.insight.count({
    where: { userId, source: 'reflector', createdAt: { gte: dayStart } },
  });
  if (already > 0) return { ran: false, created: 0, superseded: 0 };
  const res = await runReflector(userId, now);
  return { ran: true, ...res };
}
