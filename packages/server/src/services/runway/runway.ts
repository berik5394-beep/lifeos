import { prisma } from '../../lib/prisma.js';
import { gatherReflectorFacts } from '../reflector-service.js';
import {
  computeRunway,
  describeRunway,
  computeAnchoredCash,
  type RunwayStatus,
} from './types.js';
import { isV2RunwayBalanceEnabled } from '../../lib/feature-flags.js';

export interface Runway {
  cashOnHand: number;
  monthlyIncome: number;
  monthlyBurn: number;
  netBurnRate: number;
  runwayMonths: number | null;
  status: RunwayStatus;
  insightText: string;
}

/**
 * Кросс-доменный инсайт выживаемости кэша: накопленный net ÷ чистый отток.
 * READ-ONLY. null если кэш-flow положителен / нет данных / запас здоров (молчим).
 */
export async function buildRunway(
  userId: string,
  now: Date = new Date(),
  // Дедуп: если reflector-факты уже посчитаны выше (enrichment делит их с
  // goal-impact), переиспользуем — НЕ гоняем gatherReflectorFacts повторно.
  prefetchedFacts?: Awaited<ReturnType<typeof gatherReflectorFacts>> | null,
): Promise<Runway | null> {
  try {
    const [facts, incAgg, expAgg] = await Promise.all([
      prefetchedFacts ?? gatherReflectorFacts(userId, now),
      prisma.income.aggregate({ _sum: { amount: true }, where: { userId } }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: { userId } }),
    ]);
    // По умолчанию cashOnHand — накопленный net за ВСЁ время (без якоря).
    let cashOnHand = (incAgg._sum.amount ?? 0) - (expAgg._sum.amount ?? 0);
    let hasAnchor = false;
    // Якорь: если юзер назвал баланс (CashSnapshot) — считаем вперёд от него.
    if (isV2RunwayBalanceEnabled(userId)) {
      const snap = await prisma.cashSnapshot.findFirst({
        where: { userId },
        orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
      });
      if (snap) {
        const [expSince, incSince] = await Promise.all([
          prisma.expense.aggregate({
            _sum: { amount: true },
            where: { userId, date: { gt: snap.asOf } },
          }),
          prisma.income.aggregate({
            _sum: { amount: true },
            where: { userId, date: { gt: snap.asOf } },
          }),
        ]);
        cashOnHand = computeAnchoredCash({
          balance: snap.balance,
          expensesSince: expSince._sum.amount ?? 0,
          incomesSince: incSince._sum.amount ?? 0,
        });
        hasAnchor = true;
      }
    }
    const r = computeRunway({
      cashOnHand,
      monthlyIncome: facts.monthlyIncome,
      monthlyBurn: facts.monthlyBurn,
    });
    // Без якоря — старое поведение: молчим при здоровом/положительном/no_data.
    if (
      !hasAnchor &&
      (r.status === 'healthy' || r.status === 'cash_positive' || r.status === 'no_data')
    ) {
      return null;
    }
    // С якорём — нечего проецировать только если вообще нет темпа трат.
    if (hasAnchor && r.status === 'no_data') return null;
    const insightText = describeRunway(r, cashOnHand, {
      hasAnchor,
      monthlyIncome: facts.monthlyIncome,
    });
    if (!insightText) return null;

    return {
      cashOnHand,
      monthlyIncome: facts.monthlyIncome,
      monthlyBurn: facts.monthlyBurn,
      netBurnRate: r.netBurnRate,
      runwayMonths: r.runwayMonths,
      status: r.status,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[runway] buildRunway failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
