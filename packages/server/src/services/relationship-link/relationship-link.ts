import { prisma } from '../../lib/prisma.js';
import { getEntityGraph } from '../entity-graph/index.js';
import {
  pickRelationshipLink,
  describeRelationshipLink,
  type StalePerson,
  type OpenObligation,
  type ObligationDirection,
} from './types.js';

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;
const MIN_IMPORTANCE = 5;

export interface RelationshipNudge {
  personName: string;
  daysSince: number;
  direction: ObligationDirection;
  description: string;
  importance: number;
  insightText: string;
}

/**
 * Кросс-доменный инсайт: застоявшийся человек × открытое обязательство по нему
 * (через personEntityId FK). READ-ONLY. null если нет такой связки (молчим —
 * чистую staleness ведёт detectStaleEntity).
 */
export async function buildRelationshipNudge(
  userId: string,
  now: Date = new Date(),
): Promise<RelationshipNudge | null> {
  try {
    const graph = getEntityGraph();
    const stale = await graph.staleEntities(userId, STALE_DAYS, MIN_IMPORTANCE);
    const persons: StalePerson[] = stale
      .filter((e) => e.type === 'person')
      .map((e) => ({
        id: e.id,
        name: e.name,
        importance: e.importance,
        daysSince: Math.max(
          1,
          Math.floor((now.getTime() - e.lastSeenAt.getTime()) / DAY_MS),
        ),
      }));
    if (persons.length === 0) return null;

    const staleIds = persons.map((p) => p.id);
    const obls = await prisma.obligation.findMany({
      where: { userId, status: 'open', personEntityId: { in: staleIds } },
      select: { personEntityId: true, direction: true, description: true },
    });

    const obligationsByEntity: Record<string, OpenObligation[]> = {};
    for (const o of obls) {
      if (!o.personEntityId) continue;
      (obligationsByEntity[o.personEntityId] ??= []).push({
        direction: o.direction as ObligationDirection,
        description: o.description,
      });
    }

    const link = pickRelationshipLink(persons, obligationsByEntity);
    if (!link) return null;
    const insightText = describeRelationshipLink(link);
    const importance =
      persons.find((p) => p.name === link.personName)?.importance ?? MIN_IMPORTANCE;

    return {
      personName: link.personName,
      daysSince: link.daysSince,
      direction: link.direction,
      description: link.description,
      importance,
      insightText,
    };
  } catch (err) {
    console.warn(
      '[relationship-link] buildRelationshipNudge failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
