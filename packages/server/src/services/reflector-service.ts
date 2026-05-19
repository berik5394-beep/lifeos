import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { reflect, type ReflectorFacts } from './reflector-core.js';
import { persistCandidates } from './insight-store.js';
import { planVsFact } from './plan-vs-fact.js';
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

async function gatherReflectorFacts(
  userId: string,
  now: Date,
): Promise<ReflectorFacts> {
  const year = now.getFullYear();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const [incAgg, expAgg, goals, planWeeks] = await Promise.all([
    prisma.income.aggregate({
      where: { userId, date: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: since } },
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

  // Де-хардкод 35M: реальная фин-цель юзера с числовым target.
  const finGoal =
    goals.find((g) => FIN_RE.test(g.area) && g.target != null) ?? null;

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
    financeGoalTarget: finGoal?.target ?? null,
    financeGoalText: finGoal?.goalText ?? null,
    goalVerdicts,
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || candidates.length === 0) return candidates;

  const system =
    `Ты — LifeOS-ассистент, стиль «${style}». Перепиши каждое ` +
    `сообщение в этом стиле, КОРОТКО (1-3 предложения), на русском. ` +
    `СТРОГО запрещено менять или выдумывать числа, суммы, проценты, ` +
    `сроки — они уже точные (из БД). Только тон/формулировка. Верни ` +
    `ТОЛЬКО JSON-массив строк той же длины и порядка, без обёрток.`;
  const user = JSON.stringify(candidates.map((c) => c.message));

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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
