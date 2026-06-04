export interface SleepDay {
  sleepHours: number;
  completionPct: number; // 0..100
}

export type ContrastStatus = 'insufficient' | 'weak' | 'link';

export interface Contrast {
  status: ContrastStatus;
  goodN: number;
  poorN: number;
  goodAvg: number | null; // средний % в дни сна ≥ порога
  poorAvg: number | null; // средний % в дни сна < порога
  gapPct: number | null; // goodAvg − poorAvg
}

const SLEEP_THRESHOLD_H = 7;
const MIN_PER_BUCKET = 4;
const MIN_GAP_PCT = 15;

/** Пара (сон, %выполнения) только для дат, присутствующих в ОБОИХ источниках. */
export function pairDays(
  journalByDate: Record<string, number>, // dateKey → sleepHours
  completionByDate: Record<string, number>, // dateKey → % (0..100)
): SleepDay[] {
  const out: SleepDay[] = [];
  for (const [k, sleepHours] of Object.entries(journalByDate)) {
    const completionPct = completionByDate[k];
    if (completionPct === undefined) continue;
    out.push({ sleepHours, completionPct });
  }
  return out;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Контраст среднего %выполнения между «хороший сон» и «мало сна». */
export function bucketContrast(
  pairs: SleepDay[],
  thresholdH = SLEEP_THRESHOLD_H,
  minPerBucket = MIN_PER_BUCKET,
  minGapPct = MIN_GAP_PCT,
): Contrast {
  const good = pairs.filter((p) => p.sleepHours >= thresholdH);
  const poor = pairs.filter((p) => p.sleepHours < thresholdH);
  const goodN = good.length;
  const poorN = poor.length;
  if (goodN < minPerBucket || poorN < minPerBucket) {
    return { status: 'insufficient', goodN, poorN, goodAvg: null, poorAvg: null, gapPct: null };
  }
  const goodAvg = Math.round(avg(good.map((p) => p.completionPct)));
  const poorAvg = Math.round(avg(poor.map((p) => p.completionPct)));
  const gapPct = goodAvg - poorAvg;
  const status: ContrastStatus = Math.abs(gapPct) >= minGapPct ? 'link' : 'weak';
  return { status, goodN, poorN, goodAvg, poorAvg, gapPct };
}

/** Строка только для подтверждённой связи (link) с положительным разрывом. */
export function describeEnergyLink(c: Contrast): string | null {
  if (c.status !== 'link' || c.gapPct == null || c.gapPct <= 0) return null;
  return (
    `🛌 В дни сна ≥7ч ты в среднем закрываешь ${c.goodAvg}% дел, при <7ч — ` +
    `${c.poorAvg}%. Сон правда двигает твою продуктивность.`
  );
}
