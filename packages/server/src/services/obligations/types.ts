export type Direction = 'i_owe' | 'owed_to_me';
export type ObligationKind = 'action' | 'money';
export type ObligationStatus = 'open' | 'done' | 'cancelled';

/** Срок в прошлом относительно now. Нет срока → не просрочено. */
export function isOverdue(dueDate: Date | null, now: Date): boolean {
  if (!dueDate) return false;
  return dueDate.getTime() < now.getTime();
}

/** Сырое направление (рус/канон) → канон или null. */
export function normalizeDirection(raw: string): Direction | null {
  const s = raw.trim().toLowerCase();
  if (s === 'i_owe' || s.includes('я должен') || s.includes('я обещал')) return 'i_owe';
  if (s === 'owed_to_me' || s.includes('мне должны') || s.includes('мне обещал')) {
    return 'owed_to_me';
  }
  return null;
}

/** Человекочитаемый ярлык обязательства. */
export function obligationLabel(o: {
  direction: Direction;
  personName: string;
  description: string;
}): string {
  const head = o.direction === 'i_owe' ? 'Ты должен' : 'Тебе должен';
  return `${head}: ${o.personName} — ${o.description}`;
}
