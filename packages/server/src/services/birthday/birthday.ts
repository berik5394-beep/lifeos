import { prisma } from '../../lib/prisma.js';
import {
  parseBirthday,
  upcomingBirthdays,
  formatBirthdaySection,
  pickDeathDate,
  formatMemorialSection,
  type PersonBirthdayRow,
  type UpcomingBirthday,
} from './types.js';

/**
 * Память ДР — read-only гейтер. Читает person-сущности юзера, у которых
 * в attributes есть валидный birthday. Никаких записей (money-safety).
 */
export async function listPersonBirthdays(userId: string): Promise<PersonBirthdayRow[]> {
  const rows = await prisma.entity.findMany({
    where: { userId, type: 'person' },
    select: { id: true, name: true, importance: true, attributes: true },
  });
  const out: PersonBirthdayRow[] = [];
  for (const r of rows) {
    const attrs = (r.attributes ?? {}) as Record<string, unknown>;
    const bday = parseBirthday(attrs.birthday);
    if (!bday) continue;
    const pt = attrs.personType;
    out.push({
      entityId: r.id,
      name: r.name,
      importance: r.importance,
      birthday: bday,
      personType: typeof pt === 'string' ? pt : undefined,
    });
  }
  return out;
}

/** Ближайшие ДР в окне windowDays (для детектора и enrichment). */
export async function buildUpcomingBirthdays(
  userId: string,
  now: Date,
  windowDays: number,
): Promise<UpcomingBirthday[]> {
  const persons = await listPersonBirthdays(userId);
  return upcomingBirthdays(persons, now, windowDays);
}

/** Enrichment-секция «Скоро ДР: …» (окно 7 дней) или null. */
export async function buildBirthdaySection(userId: string): Promise<string | null> {
  const rows = await buildUpcomingBirthdays(userId, new Date(), 7);
  return formatBirthdaySection(rows);
}

/**
 * Память дней памяти — read-only. Читает person-сущности с любым ключом
 * даты смерти (capture-extractor пишет имя ключа свободно). Никаких записей.
 */
export async function listMemorials(userId: string): Promise<PersonBirthdayRow[]> {
  const rows = await prisma.entity.findMany({
    where: { userId, type: 'person' },
    select: { id: true, name: true, importance: true, attributes: true },
  });
  const out: PersonBirthdayRow[] = [];
  for (const r of rows) {
    const attrs = (r.attributes ?? {}) as Record<string, unknown>;
    const bday = parseBirthday(pickDeathDate(attrs));
    if (!bday) continue;
    out.push({ entityId: r.id, name: r.name, importance: r.importance, birthday: bday });
  }
  return out;
}

/** Ближайшие дни памяти в окне windowDays (для детектора и enrichment). */
export async function buildUpcomingMemorials(
  userId: string,
  now: Date,
  windowDays: number,
): Promise<UpcomingBirthday[]> {
  const persons = await listMemorials(userId);
  return upcomingBirthdays(persons, now, windowDays);
}

/** Enrichment-секция «День памяти: …» (окно 7 дней) или null. */
export async function buildMemorialSection(userId: string): Promise<string | null> {
  const rows = await buildUpcomingMemorials(userId, new Date(), 7);
  return formatMemorialSection(rows);
}
