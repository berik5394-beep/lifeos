import { prisma } from '../../lib/prisma.js';
import {
  pickNeglectedKeyPerson,
  describeNeglected,
  type TypedPerson,
  type PersonType,
  type NeglectedKeyPerson,
} from './types.js';

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;
const MIN_IMPORTANCE = 5;

export interface NeglectedNudge extends NeglectedKeyPerson {
  insightText: string;
  importance: number; // importance выбранного — для значимости детектора
}

/**
 * Кросс-доменный инсайт: важный ЗАПУЩЕННЫЙ человек (по типу/важности) ×
 * owed_to_me деньги по нему. READ-ONLY. null если некого. Свой findMany
 * (нужен attributes.personType, которого нет в staleEntities-проекции).
 */
export async function buildNeglectedKeyPerson(
  userId: string,
  now: Date = new Date(),
): Promise<NeglectedNudge | null> {
  try {
    const staleAt = new Date(now.getTime() - STALE_DAYS * DAY_MS);
    const rows = await prisma.entity.findMany({
      where: { userId, type: 'person', importance: { gte: MIN_IMPORTANCE }, lastSeenAt: { lt: staleAt } },
      select: { id: true, name: true, importance: true, lastSeenAt: true, attributes: true },
      orderBy: { importance: 'desc' },
    });
    if (rows.length === 0) return null;

    const persons: TypedPerson[] = rows.map((r) => {
      const attrs = (r.attributes ?? {}) as Record<string, unknown>;
      const pt = attrs.personType;
      return {
        id: r.id,
        name: r.name,
        type: typeof pt === 'string' ? (pt as PersonType) : undefined,
        importance: r.importance,
        daysSince: Math.max(1, Math.floor((now.getTime() - r.lastSeenAt.getTime()) / DAY_MS)),
      };
    });

    const ids = persons.map((p) => p.id);
    const owed = await prisma.obligation.findMany({
      where: { userId, status: 'open', kind: 'money', direction: 'owed_to_me', personEntityId: { in: ids } },
      select: { personEntityId: true, amount: true },
    });
    const owedByEntity: Record<string, number> = {};
    for (const o of owed) {
      if (o.personEntityId && o.amount) owedByEntity[o.personEntityId] = (owedByEntity[o.personEntityId] ?? 0) + o.amount;
    }

    const picked = pickNeglectedKeyPerson(persons, owedByEntity);
    if (!picked) return null;
    const importance = persons.find((p) => p.name === picked.name)?.importance ?? MIN_IMPORTANCE;
    return { ...picked, insightText: describeNeglected(picked), importance };
  } catch (err) {
    console.warn('[person-types] buildNeglectedKeyPerson failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
