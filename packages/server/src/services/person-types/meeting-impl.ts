import { prisma } from '../../lib/prisma.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { localDateOnlyUTC, localTimeStr } from '../../lib/tz.js';
import { matchPersonInText, minutesUntil, describeMeetingBrief, type PersonMeetingBrief } from './meeting.js';
import type { PersonType } from './types.js';

const DAY_MS = 86_400_000;

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
    });
    const oblByEntity = new Map<string, { desc?: string; owed?: number }>();
    for (const o of obls) {
      if (!o.personEntityId) continue;
      const cur = oblByEntity.get(o.personEntityId) ?? {};
      if (!cur.desc) cur.desc = o.description;
      if (o.kind === 'money' && o.direction === 'owed_to_me' && o.amount) cur.owed = (cur.owed ?? 0) + o.amount;
      oblByEntity.set(o.personEntityId, cur);
    }

    const dealByEntity = new Map<string, string>();
    const { isV2DealsEnabled } = await import('../../lib/feature-flags.js');
    if (isV2DealsEnabled(userId)) {
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
      if (!type && !ob?.desc && !ob?.owed && !deal) continue; // D1-гейт: только с CRM-контекстом
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
