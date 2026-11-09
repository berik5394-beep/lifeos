import { prisma } from '../../lib/prisma.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { localDateOnlyUTC, localTimeStr } from '../../lib/tz.js';
import { matchPersonInText, minutesUntil, describeMeetingBrief, type PersonMeetingBrief } from './meeting.js';
import type { PersonType } from './types.js';

const DAY_MS = 86_400_000;

/** Типы памяти, которые говорят о человеке (не журнал действий и не сообщения). */
const ABOUT_TYPES = ['fact', 'preference', 'person', 'decision', 'event', 'emotion'];

/**
 * Последнее, что помню о человеке: запись памяти со ссылкой на него или с его
 * именем. Действующая (не «Неправда», не истекла). Свой try — без памяти бриф
 * всё равно строится.
 */
async function lastMemoryAbout(userId: string, entityId: string, name: string, now: Date): Promise<string | undefined> {
  try {
    const row = await prisma.memory.findFirst({
      where: {
        userId,
        type: { in: ABOUT_TYPES },
        source: { not: 'v2-episodic' },
        OR: [{ entityRefs: { has: entityId } }, { content: { contains: name, mode: 'insensitive' } }],
        AND: [
          { OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return row?.content?.trim() || undefined;
  } catch (err) {
    console.warn('[person-types] meeting brief: memory lookup failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Бриф перед встречей: сегодняшние ВНУТРЕННИЕ CalendarEvent × person-сущности
 * (консервативный матч имени) × тип/каденс/обязательство/owed-деньги. READ-ONLY.
 * D1-гейт: бриф только если есть CRM-контекст (тип ИЛИ дело ИЛИ долг тебе).
 * Время — наша lib/tz (НЕ Google, НЕ серверный UTC). Сорт по близости.
 */
export async function buildPersonMeetingBriefs(
  userId: string,
  now: Date = new Date(),
): Promise<PersonMeetingBrief[]> {
  try {
    const tz = await getUserTimezone(userId);
    const today = localDateOnlyUTC(tz, now);
    const nowHHMM = localTimeStr(tz, now);
    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: today, startTime: { not: null } },
      select: { title: true, description: true, startTime: true },
    });
    if (events.length === 0) return [];
    const people = await prisma.entity.findMany({
      where: { userId, type: 'person' },
      select: { id: true, name: true, aliases: true, attributes: true, lastSeenAt: true },
    });
    if (people.length === 0) return [];

    const obls = await prisma.obligation.findMany({
      where: { userId, status: 'open', personEntityId: { in: people.map((p) => p.id) } },
      select: { personEntityId: true, kind: true, direction: true, amount: true, description: true },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    type Obl = { desc?: string; owed?: number; iOwe?: number; iPromised?: string; theyPromised?: string };
    const oblByEntity = new Map<string, Obl>();
    for (const o of obls) {
      if (!o.personEntityId) continue;
      const cur = oblByEntity.get(o.personEntityId) ?? {};
      if (!cur.desc) cur.desc = o.description;
      if (o.kind === 'money' && o.amount) {
        if (o.direction === 'owed_to_me') cur.owed = (cur.owed ?? 0) + o.amount;
        else if (o.direction === 'i_owe') cur.iOwe = (cur.iOwe ?? 0) + o.amount;
      } else if (o.kind === 'action') {
        if (o.direction === 'i_owe' && !cur.iPromised) cur.iPromised = o.description;
        else if (o.direction === 'owed_to_me' && !cur.theyPromised) cur.theyPromised = o.description;
      }
      oblByEntity.set(o.personEntityId, cur);
    }

    const dealByEntity = new Map<string, string>();
    // Свой try: сбой сделок не должен ронять ВСЕ брифы встреч — идём дальше без них.
    try {
      const { dealBriefLine, OPEN_STAGES } = await import('../deals/index.js');
      const deals = await prisma.deal.findMany({
        where: { userId, stage: { in: [...OPEN_STAGES] }, personEntityId: { in: people.map((p) => p.id) } },
        orderBy: { amount: { sort: 'desc', nulls: 'last' } },
        select: { personEntityId: true, title: true, amount: true, stage: true, stageChangedAt: true },
      });
      for (const d of deals) {
        if (!d.personEntityId || dealByEntity.has(d.personEntityId)) continue;
        const daysInStage = Math.max(0, Math.floor((now.getTime() - d.stageChangedAt.getTime()) / DAY_MS));
        dealByEntity.set(d.personEntityId, dealBriefLine({ title: d.title, amount: d.amount, stage: d.stage, daysInStage }));
      }
    } catch (err) {
      console.warn('[person-types] meeting brief: deals lookup failed, brief without deals:', err instanceof Error ? err.message : err);
      dealByEntity.clear();
    }

    const briefs: PersonMeetingBrief[] = [];
    for (const e of events) {
      const mins = minutesUntil(nowHHMM, e.startTime as string);
      if (mins <= 0) continue; // уже прошло
      const text = `${e.title} ${e.description ?? ''}`;
      const person = people.find((p) => matchPersonInText(p.name, p.aliases, text));
      if (!person) continue;
      const attrs = (person.attributes ?? {}) as Record<string, unknown>;
      const type = typeof attrs.personType === 'string' ? (attrs.personType as PersonType) : undefined;
      const ob = oblByEntity.get(person.id);
      const deal = dealByEntity.get(person.id);
      const remembered = await lastMemoryAbout(userId, person.id, person.name, now);
      // D1-гейт: только с контекстом (тип/дело/деньги/сделка/память) — иначе обычное напоминание.
      if (!type && !ob?.desc && !ob?.owed && !ob?.iOwe && !deal && !remembered) continue;
      const daysSince = Math.max(0, Math.floor((now.getTime() - person.lastSeenAt.getTime()) / DAY_MS));
      const brief: PersonMeetingBrief = {
        entityId: person.id,
        name: person.name,
        type,
        startTime: e.startTime as string,
        minutesUntil: mins,
        daysSince,
        obligation: ob?.desc,
        owed: ob?.owed,
        iOwe: ob?.iOwe,
        iPromised: ob?.iPromised,
        theyPromised: ob?.theyPromised,
        remembered,
        eventTitle: e.title,
        deal,
      };
      brief.insightText = describeMeetingBrief(brief);
      briefs.push(brief);
    }
    briefs.sort((a, b) => a.minutesUntil - b.minutesUntil);
    return briefs;
  } catch (err) {
    console.warn('[person-types] buildPersonMeetingBriefs failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
