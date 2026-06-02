/**
 * Ресурсо-агностичное ядро движка пересечения: ёмкость ресурса vs сумма
 * спроса. Не влезает → защищаем важные (greedy по importance desc),
 * остальное → overflow (кандидаты на перенос/урезание). Та же форма, что
 * у денег (computePortfolioPace) — деньги сведём на это ядро позже.
 * Чистое, без БД/AI.
 */
export interface CapacityItem {
  label: string;
  demand: number; // в той же единице, что capacity (минуты/₸)
  importance: number; // больше = важнее
}
export interface CapacityFitInput {
  capacity: number;
  items: CapacityItem[];
}
export type CapacityStatus = 'fits' | 'tight' | 'overloaded';
export interface CapacityFit {
  status: CapacityStatus;
  capacity: number;
  totalDemand: number;
  overBy: number; // max(0, totalDemand − capacity)
  fit: CapacityItem[]; // влезают (по убыванию importance)
  overflow: CapacityItem[]; // не влезают
}

const TIGHT_FACTOR = 0.85;

export function computeCapacityFit(input: CapacityFitInput): CapacityFit {
  const { capacity, items } = input;
  const totalDemand = items.reduce((s, i) => s + i.demand, 0);
  const overBy = Math.max(0, totalDemand - capacity);

  const sorted = items.slice().sort((a, b) => b.importance - a.importance);
  const fit: CapacityItem[] = [];
  const overflow: CapacityItem[] = [];
  let used = 0;
  for (const it of sorted) {
    if (capacity > 0 && used + it.demand <= capacity) {
      fit.push(it);
      used += it.demand;
    } else {
      overflow.push(it);
    }
  }

  let status: CapacityStatus;
  if (totalDemand > capacity) status = 'overloaded';
  else if (capacity > 0 && totalDemand >= TIGHT_FACTOR * capacity) status = 'tight';
  else status = 'fits';

  return { status, capacity, totalDemand, overBy, fit, overflow };
}
