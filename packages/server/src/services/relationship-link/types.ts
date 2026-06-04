export type ObligationDirection = 'i_owe' | 'owed_to_me';

export interface StalePerson {
  id: string;
  name: string;
  daysSince: number;
  importance: number;
}

export interface OpenObligation {
  direction: ObligationDirection;
  description: string;
}

export interface RelationshipLink {
  personName: string;
  daysSince: number;
  direction: ObligationDirection;
  description: string;
}

/**
 * Первый застоявшийся человек (persons отсортированы по importance desc),
 * у которого есть ≥1 открытое обязательство. Берём первое обязательство.
 * Никто не имеет обязательства → null.
 */
export function pickRelationshipLink(
  persons: StalePerson[],
  obligationsByEntity: Record<string, OpenObligation[]>,
): RelationshipLink | null {
  for (const p of persons) {
    const obls = obligationsByEntity[p.id];
    if (obls && obls.length > 0) {
      const o = obls[0];
      return {
        personName: p.name,
        daysSince: p.daysSince,
        direction: o.direction,
        description: o.description,
      };
    }
  }
  return null;
}

/** Человеческая строка под направление обязательства. */
export function describeRelationshipLink(link: RelationshipLink): string {
  const head = `🤝 Не общались с ${link.personName} уже ${link.daysSince} дн`;
  if (link.direction === 'i_owe') {
    return `${head}, а ты ему должен: «${link.description}». Написать?`;
  }
  return `${head}, а он тебе должен: «${link.description}». Напомнить?`;
}
