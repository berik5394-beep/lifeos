export type PersonType = 'client' | 'partner' | 'investor' | 'family' | 'friend';

export interface TypedPerson {
  id: string;
  name: string;
  type?: PersonType;
  importance: number;
  daysSince: number;
}

export interface NeglectedKeyPerson {
  name: string;
  type?: PersonType;
  daysSince: number;
  weightedScore: number;
  owed?: number; // owed_to_me деньги по этому человеку (сумма), если есть
}

const WEIGHTS: Record<PersonType, number> = {
  client: 1.0,
  investor: 0.95,
  partner: 0.9,
  family: 0.7,
  friend: 0.55,
};

/** Единый источник веса типа. Не задан/неизвестен → 0.6 (нейтрально между business и личным). */
export function personTypeWeight(type?: string): number {
  return (type && WEIGHTS[type as PersonType]) || 0.6;
}

/**
 * Самый «запущенный» важный человек. weightedScore = (daysSince/14) × вес типа ×
 * (importance/10). ГЕЙТ честности: нудим только если человек типизирован ИЛИ
 * importance≥7 (не спамим про случайных знакомых). max по weightedScore. owed —
 * сумма owed_to_me денег по нему (если есть). Никого → null.
 */
export function pickNeglectedKeyPerson(
  persons: TypedPerson[],
  owedByEntity: Record<string, number>,
): NeglectedKeyPerson | null {
  let best: NeglectedKeyPerson | null = null;
  for (const p of persons) {
    if (!p.type && p.importance < 7) continue; // гейт
    const weightedScore = (p.daysSince / 14) * personTypeWeight(p.type) * (p.importance / 10);
    if (!best || weightedScore > best.weightedScore) {
      const owed = owedByEntity[p.id];
      best = { name: p.name, type: p.type, daysSince: p.daysSince, weightedScore, owed: owed || undefined };
    }
  }
  return best;
}

const TYPE_LABEL: Record<PersonType, string> = {
  client: 'клиент', investor: 'инвестор', partner: 'партнёр', family: 'семья', friend: 'друг',
};

/** Текст нуджа. Деньги-aware: с owed добавляет сумму долга тебе. */
export function describeNeglected(p: NeglectedKeyPerson): string {
  const label = p.type ? `[${TYPE_LABEL[p.type]}] ` : '';
  const head = `🤝 ${label}${p.name}: ${p.daysSince} дн без контакта`;
  if (p.owed && p.owed > 0) {
    return `${head}, должен тебе ${p.owed}₸. Напомнить?`;
  }
  return `${head}. Написать?`;
}
