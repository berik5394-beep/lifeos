/**
 * «Что я о тебе помню» — экран робота. Человек видит, что робот его знает
 * (люди, факты, предпочтения, решения, что волновало), и может сказать
 * «это неправда» — память гасится обратимо (invalidAt), все читатели мозга
 * такие записи уже не используют. Раньше память была, но её не было видно.
 *
 * Журнал действий («создал задачу…», source v2-episodic) и сырые сообщения
 * сюда не идут — только знание о человеке. READ + обратимая правка.
 */
import { prisma } from '../lib/prisma.js';

/** Типы памяти, которые показываем (знание о человеке, не журнал действий). */
export const ABOUT_ME_TYPES = ['fact', 'preference', 'person', 'place', 'decision', 'event', 'emotion'] as const;
const ACTION_LOG_SOURCE = 'v2-episodic';

const MAX_FACTS = 80;
const MAX_PEOPLE = 30;

const PERSON_TYPE: Record<string, string> = {
  client: 'клиент', investor: 'инвестор', partner: 'партнёр', family: 'семья', friend: 'друг',
};
const REL_LABEL: Record<string, string> = {
  family: 'семья', friend: 'друг', colleague: 'коллега', partner: 'партнёр',
  works_at: 'работает в', lives_in: 'живёт в', connected_to: 'связан с',
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HIDDEN_ATTRS = new Set(['aliases', 'type', 'deathDate', 'memorial', 'phone', 'email']);

/**
 * Факты о человеке по-человечески: «семья · ДР 12 мая · работает: Kaspi».
 * Значения важнее ключей; служебное и контакты не показываем.
 */
export function personFacts(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
  const a = attributes as Record<string, unknown>;
  const out: string[] = [];
  if (typeof a.personType === 'string' && PERSON_TYPE[a.personType]) out.push(PERSON_TYPE[a.personType]);
  const b = a.birthday as { day?: number; month?: number } | undefined;
  if (b && typeof b.day === 'number' && typeof b.month === 'number' && b.month >= 1 && b.month <= 12) {
    out.push(`ДР ${b.day} ${MONTHS[b.month - 1]}`);
  }
  for (const [k, v] of Object.entries(a)) {
    if (k === 'personType' || k === 'birthday' || HIDDEN_ATTRS.has(k) || k.startsWith('_')) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const val = String(v).trim();
    if (!val || val.length > 80) continue;
    out.push(/^[a-z_]+$/i.test(k) && k.length <= 12 && !/^(role|relation|note|about)$/i.test(k) ? `${k}: ${val}` : val);
    if (out.length >= 5) break;
  }
  return out;
}

export interface AboutMePerson {
  id: string;
  name: string;
  facts: string[];
  relations: string[];
  importance: number;
  lastMentioned: string; // YYYY-MM-DD
}

export interface AboutMeFact {
  id: string;
  type: string;
  content: string;
  importance: number;
  createdAt: string;
  entityRefs: string[];
}

export interface AboutMe {
  people: AboutMePerson[];
  facts: AboutMeFact[];
}

export async function gatherAboutMe(userId: string, now: Date = new Date()): Promise<AboutMe> {
  const [people, facts] = await Promise.all([
    prisma.entity.findMany({
      where: { userId, type: 'person' },
      orderBy: [{ importance: 'desc' }, { lastSeenAt: 'desc' }],
      take: MAX_PEOPLE,
      select: { id: true, name: true, attributes: true, importance: true, lastSeenAt: true },
    }),
    prisma.memory.findMany({
      where: {
        userId,
        type: { in: [...ABOUT_ME_TYPES] },
        source: { not: ACTION_LOG_SOURCE },
        AND: [
          { OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: MAX_FACTS,
      select: { id: true, type: true, content: true, importance: true, createdAt: true, entityRefs: true },
    }),
  ]);
  const ids = people.map((p) => p.id);
  const rels = ids.length
    ? await prisma.entityRelationship.findMany({
        where: { userId, invalidAt: null, OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
        select: { fromId: true, toId: true, type: true, label: true, from: { select: { name: true } }, to: { select: { name: true } } },
        take: 120,
      })
    : [];
  return {
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      facts: personFacts(p.attributes),
      relations: rels
        .filter((r) => r.fromId === p.id || r.toId === p.id)
        .slice(0, 4)
        .map((r) => {
          const label = r.label?.trim() || REL_LABEL[r.type] || r.type;
          return r.fromId === p.id ? `${label} — ${r.to.name}` : `${r.from.name} — ${label}`;
        }),
      importance: p.importance,
      lastMentioned: p.lastSeenAt.toISOString().slice(0, 10),
    })),
    facts: dedupeFacts(facts).map((f) => ({
      id: f.id,
      type: f.type,
      content: f.content,
      importance: f.importance,
      createdAt: f.createdAt.toISOString(),
      entityRefs: f.entityRefs,
    })),
  };
}

/** Одинаковые формулировки (повторный захват) — одна строка, самая важная/свежая (вход уже отсортирован). */
export function dedupeFacts<T extends { content: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.content.trim().toLowerCase().replace(/[.!?…]+$/u, '').replace(/\s+/g, ' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** «Это неправда» — забыть обратимо. Только своё и только действующее. */
export async function forgetMemory(userId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.memory.updateMany({
    where: { id, userId, OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] },
    data: { invalidAt: now },
  });
  return r.count > 0;
}

/** «Вернуть» (передумал сразу после «неправда»). Только своё. */
export async function restoreMemory(userId: string, id: string): Promise<boolean> {
  const r = await prisma.memory.updateMany({ where: { id, userId, invalidAt: { not: null } }, data: { invalidAt: null } });
  return r.count > 0;
}
