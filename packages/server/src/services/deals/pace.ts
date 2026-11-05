/** Темп плана продаж месяца. Чистое. Деньги — в ₸, без сумм сделки не считаются. */
export interface PaceInput {
  plan: number;
  won: number;
  open: number;
  dayOfMonth: number;
  daysInMonth: number;
}
export interface Pace {
  behind: boolean;
  expected: number;
  gap: number;
  coverable: boolean;
}

export function salesPace(p: PaceInput): Pace {
  const expected = p.plan * (p.dayOfMonth / p.daysInMonth);
  const behind = p.dayOfMonth >= 7 && p.won < expected * 0.8;
  const gap = Math.max(0, p.plan - p.won);
  return { behind, expected, gap, coverable: p.open >= gap };
}

/** Крупнейшие открытые сделки, суммарно закрывающие разрыв; не покрыть — пусто. */
export function coveringDeals<T extends { amount: number | null }>(deals: readonly T[], gap: number): T[] {
  if (gap <= 0) return [];
  const sorted = deals
    .filter((d): d is T & { amount: number } => typeof d.amount === 'number' && d.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const out: T[] = [];
  let sum = 0;
  for (const d of sorted) {
    out.push(d);
    sum += d.amount;
    if (sum >= gap) return out;
  }
  return [];
}
