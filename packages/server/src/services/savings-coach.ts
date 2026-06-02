import type { PortfolioStatus } from './savings-pace.js';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { isV2SavingsCoachEnabled } from '../lib/feature-flags.js';
import { gatherReflectorFacts } from './reflector-service.js';
import { computePortfolioPace, describePortfolioPace } from './savings-pace.js';

/**
 * Чистый гейт реактивного коуча: после расхода говорить ТОЛЬКО когда он
 * «бьёт по цели». Защищает от занудства (см. spec §7a).
 */
export interface NudgeGateInput {
  status: PortfolioStatus;
  monthToDateExpense: number;
  monthlyIncome: number;
  requiredAnchor: number; // требование главной цели (₸/мес)
  expenseAmount: number;
  alreadyCoachedToday: boolean;
}

export function shouldNudgeOnExpense(g: NudgeGateInput): boolean {
  if (g.alreadyCoachedToday) return false;
  if (
    g.status !== 'anchor_at_risk' &&
    g.status !== 'collision' &&
    g.status !== 'stalled'
  ) {
    return false;
  }
  const goalBudget = g.monthlyIncome - g.requiredAnchor; // макс. трат/мес под главную
  const monthOverBudget = g.monthToDateExpense > goalBudget;
  const largeSingle = g.monthlyIncome > 0 && g.expenseAmount >= 0.1 * g.monthlyIncome;
  return monthOverBudget || largeSingle;
}

const GOAL_PACE_SCOPE = 'finance:goal_pace';

/**
 * Реактивный коуч после расхода. Точка схождения (текст/голос/фото).
 * Best-effort: любая ошибка → null, расход НИКОГДА не ломается и ответ
 * не задерживается. Возвращает короткую строку для дописывания к ответу
 * бота, либо null (нет цели / гейт не прошёл / флаг off / дедуп).
 */
export async function maybeSavingsCoachLine(
  userId: string,
  expenseInput: Record<string, unknown>,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2SavingsCoachEnabled(userId)) return null;
  try {
    // Сумма расхода через те же синонимы, что у add_expense
    // (sum/cost/price→amount). Оркестратор передаёт СЫРОЙ вход —
    // нормализация имён живёт в runRegistryTool, поэтому читаем алиасы
    // здесь, иначе largeSingle не сработает на естественных именах.
    const expenseAmount =
      Number(
        expenseInput.amount ??
          expenseInput.sum ??
          expenseInput.cost ??
          expenseInput.price,
      ) || 0;
    const facts = await gatherReflectorFacts(userId, now);
    if (facts.financeGoals.length === 0) return null; // нет фин-целей → молчим

    const pf = computePortfolioPace({
      goals: facts.financeGoals,
      capacity: facts.monthlyIncome - facts.monthlyBurn,
      now,
    });
    if (!pf.anchor || pf.status === 'none' || pf.status === 'on_track_all') {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const dayStart = localDayStartUTC(user?.timezone ?? 'UTC', now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [coachedToday, mtdExp] = await Promise.all([
      prisma.insight.count({
        where: { userId, scopeKey: GOAL_PACE_SCOPE, createdAt: { gte: dayStart } },
      }),
      prisma.expense.aggregate({
        where: { userId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);

    const nudge = shouldNudgeOnExpense({
      status: pf.status,
      monthToDateExpense: mtdExp._sum.amount ?? 0,
      monthlyIncome: facts.monthlyIncome,
      requiredAnchor: pf.requiredAnchor,
      expenseAmount,
      alreadyCoachedToday: coachedToday > 0,
    });
    if (!nudge) return null;

    const line = describePortfolioPace(pf);
    if (!line) return null;

    // Маркер дневного дедупа: сразу deliveredAt=now → не будет ещё и
    // запушен deliverTopInsight, и следующий реактив/дневной за сутки молчит.
    await prisma.insight
      .create({
        data: {
          userId,
          severity: 6,
          scope: { key: GOAL_PACE_SCOPE, kind: 'goal_pace_reactive' },
          scopeKey: GOAL_PACE_SCOPE,
          source: 'savings_coach',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});

    return line;
  } catch (err) {
    console.warn(
      '[savings-coach] non-fatal:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
