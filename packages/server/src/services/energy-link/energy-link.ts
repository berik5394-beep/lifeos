import { prisma } from '../../lib/prisma.js';
import {
  pairDays,
  bucketContrast,
  describeEnergyLink,
  SLEEP_THRESHOLD_H,
  type ContrastStatus,
} from './types.js';

const WINDOW_MS = 60 * 86_400_000;
const RECENT_MS = 7 * 86_400_000;

export interface EnergyLink {
  goodAvg: number | null;
  poorAvg: number | null;
  gapPct: number | null;
  goodN: number;
  poorN: number;
  status: ContrastStatus;
  recentSleepLow: boolean; // последние ~7 дней журнала сон в среднем < 7ч
  insightText: string;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Кросс-доменный инсайт «сон ↔ выполнение» бакет-контрастом. READ-ONLY.
 * null если связь не подтверждена (insufficient/weak) или парадокс (gap<0).
 */
export async function buildEnergyLink(
  userId: string,
  now: Date = new Date(),
): Promise<EnergyLink | null> {
  try {
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    const recentStart = new Date(now.getTime() - RECENT_MS);

    const [journalRows, taskRows] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { userId, date: { gte: windowStart }, sleepHours: { not: null } },
        select: { date: true, sleepHours: true },
      }),
      prisma.task.findMany({
        where: { userId, date: { gte: windowStart } },
        select: { date: true, completed: true },
      }),
    ]);

    const journalByDate: Record<string, number> = {};
    const recentSleeps: number[] = [];
    for (const r of journalRows) {
      if (r.sleepHours == null) continue;
      journalByDate[dateKey(r.date)] = r.sleepHours;
      if (r.date >= recentStart) recentSleeps.push(r.sleepHours);
    }

    const agg: Record<string, { total: number; done: number }> = {};
    for (const t of taskRows) {
      const k = dateKey(t.date);
      if (!agg[k]) agg[k] = { total: 0, done: 0 };
      agg[k].total++;
      if (t.completed) agg[k].done++;
    }
    const completionByDate: Record<string, number> = {};
    for (const [k, a] of Object.entries(agg)) {
      completionByDate[k] = Math.round((a.done / a.total) * 100);
    }

    const c = bucketContrast(pairDays(journalByDate, completionByDate));
    if (c.status !== 'link') return null;
    const insightText = describeEnergyLink(c);
    if (!insightText) return null;

    const recentSleepLow =
      recentSleeps.length > 0 &&
      recentSleeps.reduce((s, n) => s + n, 0) / recentSleeps.length < SLEEP_THRESHOLD_H;

    return {
      goodAvg: c.goodAvg,
      poorAvg: c.poorAvg,
      gapPct: c.gapPct,
      goodN: c.goodN,
      poorN: c.poorN,
      status: c.status,
      recentSleepLow,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[energy-link] buildEnergyLink failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
