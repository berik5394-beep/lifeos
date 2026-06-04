import { prisma } from '../../lib/prisma.js';
import { gatherReflectorFacts } from '../reflector-service.js';
import { computePortfolioPace } from '../savings-pace.js';
import {
  computeCategoryImpact,
  computeObligationImpact,
  describeGoalImpact,
  pickTopCategory,
  type CategorySpend,
} from './types.js';

export interface GoalImpact {
  goalText: string;
  requiredMonthly: number;
  topCategory: CategorySpend | null;
  categoryShare: number | null;
  totalOwed: number;
  monthsDelay: number | null;
  status: string;
  insightText: string;
}

/**
 * Кросс-доменный инсайт: как траты-категории текущего месяца и открытые
 * денежные долги «я должен» (i_owe) «съедают» главную денежную цель.
 *
 * READ-ONLY. Реюзит портфельный пейсер (как savings-coach): requiredMonthly
 * = pf.requiredAnchor для якорной (самой денежной) цели. null если денежной
 * цели нет / цель уже тянется (none|on_track_all) / нечего сказать.
 */
export async function buildGoalImpact(
  userId: string,
  now: Date = new Date(),
  // Дедуп: enrichment делит reflector-факты с runway — не гоняем повторно.
  prefetchedFacts?: Awaited<ReturnType<typeof gatherReflectorFacts>> | null,
): Promise<GoalImpact | null> {
  try {
    const facts = prefetchedFacts ?? (await gatherReflectorFacts(userId, now));
    if (facts.financeGoals.length === 0) return null;
    const pf = computePortfolioPace({
      goals: facts.financeGoals,
      capacity: facts.monthlyIncome - facts.monthlyBurn,
      now,
    });
    // Гейт: есть якорная цель И НЕ «всё на треке» (consistent с savings-coach).
    if (!pf.anchor || pf.status === 'none' || pf.status === 'on_track_all') {
      return null;
    }
    const requiredMonthly = pf.requiredAnchor;
    if (requiredMonthly <= 0) return null;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [byCatRaw, owedAgg] = await Promise.all([
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.obligation.aggregate({
        _sum: { amount: true },
        where: { userId, kind: 'money', direction: 'i_owe', status: 'open' },
      }),
    ]);

    const byCategory: CategorySpend[] = byCatRaw.map((row) => ({
      category: row.category,
      amount: row._sum.amount ?? 0,
    }));
    const topCategory = pickTopCategory(byCategory);
    const totalOwed = owedAgg._sum.amount ?? 0;
    const goalText = pf.anchor.goal.text;

    const catImpact = topCategory
      ? computeCategoryImpact(topCategory.amount, requiredMonthly)
      : null;
    const oblImpact =
      totalOwed > 0 ? computeObligationImpact(totalOwed, requiredMonthly) : null;
    const insightText = describeGoalImpact(
      goalText,
      requiredMonthly,
      topCategory,
      totalOwed,
    );
    if (!insightText) return null;

    return {
      goalText,
      requiredMonthly,
      topCategory,
      categoryShare: catImpact?.share ?? null,
      totalOwed,
      monthsDelay: oblImpact?.monthsDelay ?? null,
      status: pf.status,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[goal-impact] buildGoalImpact failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
