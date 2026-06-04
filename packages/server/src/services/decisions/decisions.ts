import { prisma } from '../../lib/prisma.js';
import { computeWinRate } from './types.js';

export interface DecisionsContext {
  dueForReview: Array<{ title: string; expectedOutcome: string | null; decidedAt: Date }>;
  winRate: ReturnType<typeof computeWinRate>;
}

/**
 * READ-ONLY кросс-домен контекст решений: открытые решения, которым пора
 * ретро (reviewDate <= now), + win-rate по уже проверенным. null если пусто.
 */
export async function buildDecisionsContext(
  userId: string,
  now: Date = new Date(),
): Promise<DecisionsContext | null> {
  try {
    const [due, reviewed] = await Promise.all([
      prisma.decision.findMany({
        where: { userId, status: 'open', reviewDate: { lte: now } },
        orderBy: { reviewDate: 'asc' },
        take: 5,
        select: { title: true, expectedOutcome: true, decidedAt: true },
      }),
      prisma.decision.findMany({
        where: { userId, status: 'reviewed' },
        select: { verdict: true },
      }),
    ]);
    const winRate = computeWinRate(reviewed);
    if (due.length === 0 && winRate.reviewed === 0) return null;
    return { dueForReview: due, winRate };
  } catch (err) {
    console.warn(
      '[decisions] buildDecisionsContext failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
