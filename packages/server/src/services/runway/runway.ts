import { prisma } from '../../lib/prisma.js';
import { gatherReflectorFacts } from '../reflector-service.js';
import { computeRunway, describeRunway, type RunwayStatus } from './types.js';

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
): Promise<Runway | null> {
  try {
    const [facts, incAgg, expAgg] = await Promise.all([
      gatherReflectorFacts(userId, now),
      prisma.income.aggregate({ _sum: { amount: true }, where: { userId } }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: { userId } }),
    ]);
    // ВНИМАНИЕ (осознанно): cashOnHand — накопленный net за ВСЁ время, а
    // monthlyIncome/monthlyBurn из reflector — за окно ~90 дней (свежий темп).
    // Разные горизонты намеренны: «сколько накоплено» ÷ «текущий темп оттока».
    // Не «чинить» в один горизонт. describeRunway честно говорит «по записям».
    const cashOnHand = (incAgg._sum.amount ?? 0) - (expAgg._sum.amount ?? 0);
    const r = computeRunway({
      cashOnHand,
      monthlyIncome: facts.monthlyIncome,
      monthlyBurn: facts.monthlyBurn,
    });
    // Гейт: ноем только при коротком/underwater запасе.
    if (r.status === 'healthy' || r.status === 'cash_positive' || r.status === 'no_data') {
      return null;
    }
    const insightText = describeRunway(r, cashOnHand);
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
