/**
 * «Наша связь» — характер разговора друга (Berik 2026-11-10, анализ Replika:
 * docs/plan/replika-analysis-2026-11.md). Механики дружбы у робота были
 * (память, «как ты?», дневник, уровень), но в разговоре он вёл себя как
 * исполнитель: правило «не упоминай прошлые темы» не давало вспомнить важное.
 *
 * Здесь — блок для мозга:
 *  1. «Наша история»: сколько вы знакомы, круглая дата сегодня;
 *  2. «Незакрытое» (follow-ups.ts): прошедшее значимое событие из календаря/задач,
 *     переживание из разговора — друг спросил бы «как прошло?»;
 *  3. «Твой дневник»: вчерашняя запись робота — чтобы было чем поделиться
 *     (взаимность — так строится близость, а не только «отвечать и выполнять»).
 * Только факты из БД — ничего не выдумываем. Сбой — null, разговор как раньше.
 */
import { prisma } from '../lib/prisma.js';
import { currentFollowUp, formatFollowUp, type FollowUp } from './follow-ups.js';
import { gatherJourney } from './journey.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateOnlyUTC, localDateStr } from '../lib/tz.js';
import { annotateRelativeDates } from '../lib/relative-dates.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Круглые даты знакомства, которые друг отметит. */
export const BOND_MILESTONES = [7, 30, 50, 100, 200, 365, 500, 730, 1000] as const;
const DIARY_MAX_CHARS = 220;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Сколько дней вы знакомы (по календарю человека; день регистрации = 0). */
export function daysTogether(createdLocal: Date, todayLocal: Date): number {
  return Math.max(0, Math.round((todayLocal.getTime() - createdLocal.getTime()) / DAY_MS));
}

/** «47 дней», «1 день», «22 дня» */
export function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

export interface BondFacts {
  days: number;
  since: Date;
  milestone: number | null;
  /** Сколько дней прошло с круглой даты (0 — сегодня; окно до 3 дней, G). */
  milestoneAgo?: number;
  /** Вехи пути (journey.ts) — факты с датами. */
  journey?: string | null;
  /** Незакрытое (follow-ups.ts): о чём спросить «как прошло?». */
  thread: FollowUp | null;
  diary: string | null;
  /** Знакомство (первая неделя): о чём робот ещё не знает. Пусто/нет — уже знакомы. */
  unknown?: string[];
  /**
   * Человек выключил (E, 2026-11-10): 'no-checkins' — «Робот спрашивает «как ты?»»;
   * 'no-support' — режим поддержки. Тогда сам личных расспросов робот не заводит.
   */
  quiet?: 'no-checkins' | 'no-support';
}

/** Первая неделя — робот узнаёт человека (как друг, а не анкета). */
export const ACQUAINTANCE_DAYS = 7;

/** Темы знакомства и как понять, что уже известно (по памяти и данным). */
export const ACQUAINTANCE_TOPICS = {
  people: 'кто его близкие (как зовут, кто они ему)',
  work: 'чем он занимается — работа или учёба',
  priority: 'что для него сейчас главное в жизни',
  worry: 'что его сейчас волнует или тревожит',
  joy: 'что он любит, чем отдыхает и заряжается',
} as const;
export type AcquaintanceTopic = keyof typeof ACQUAINTANCE_TOPICS;

const WORK_RE = /работ|учусь|учёб|учеб|студент|бизнес|компани|професси|должност|занимаюсь|предпринимател|фриланс|офис|универ/i;

/** Чего ещё не знаем (чистая функция). */
export function unknownTopics(known: {
  people: number;
  memories: Array<{ type: string; content: string }>;
  goals: number;
}): AcquaintanceTopic[] {
  const has = (types: string[]) => known.memories.some((m) => types.includes(m.type));
  const out: AcquaintanceTopic[] = [];
  if (known.people === 0 && !has(['person'])) out.push('people');
  if (!known.memories.some((m) => WORK_RE.test(m.content))) out.push('work');
  if (known.goals === 0 && !has(['decision', 'goal'])) out.push('priority');
  if (!has(['emotion'])) out.push('worry');
  if (!has(['preference'])) out.push('joy');
  return out;
}

/** Блок для мозга (чистый, тестируемый). */
export function formatBondSection(f: BondFacts): string {
  const L: string[] = [];
  const since = `${f.since.getUTCDate()} ${MONTHS[f.since.getUTCMonth()]}`;
  L.push(
    f.days === 0
      ? 'Наша история: вы знакомы с сегодняшнего дня.'
      : `Наша история: вы знакомы ${daysWord(f.days)} (с ${since}).`,
  );
  if (f.milestone) {
    const word = MILESTONE_WORD[f.milestone] ?? `${daysWord(f.milestone)}`;
    const when = !f.milestoneAgo ? 'сегодня' : f.milestoneAgo === 1 ? 'вчера' : `${f.milestoneAgo} дн. назад`;
    L.push(
      `Круглая дата: ${when} исполнилось ${word} вашего знакомства (ровно ${daysWord(f.milestone)}). Отметь именно её — ` +
        `например «${!f.milestoneAgo ? 'сегодня' : 'на днях'} ${f.milestone === 30 ? 'был месяц' : f.milestone === 7 ? 'была неделя' : f.milestone === 365 ? 'был год' : `было ${daysWord(f.milestone)}`}, как мы знакомы» — один раз, коротко, без пафоса. Не называй другое число дней.`,
    );
  }
  if (f.quiet === 'no-support') {
    L.push('Человек выключил режим поддержки: о чувствах и личном не расспрашивай сам — только если он заговорит первым; отвечай по делу.');
  } else if (f.quiet === 'no-checkins') {
    L.push('Человек выключил вопросы «как ты?»: сам личных расспросов не заводи (ни «как прошло?», ни знакомство) — откликайся, если он сам рассказывает.');
  }
  if (f.journey) L.push(f.journey);
  if (f.thread) L.push(formatFollowUp(f.thread));
  if (f.diary) L.push(`Твоя запись в дневнике (можно поделиться к месту, от первого лица): «${f.diary}»`);
  // D: один вопрос за ответ — есть незакрытое, знакомство в этот раз не подсказываем.
  if (f.unknown && f.unknown.length > 0 && !f.thread) {
    L.push(
      `Вы ещё знакомитесь. Ты пока не знаешь: ${f.unknown.join('; ')}. В личном разговоре (не в деловых командах) после ответа ` +
        'спроси об ОДНОЙ из этих тем — живо, с интересом, своими словами, не анкетой и не списком. Ответит — запомнится само; ' +
        'не переспрашивай то, что он уже рассказал в этом разговоре. Просит «давай познакомимся» — одна тёплая фраза о себе (без перечня функций и без вопросов про приложение) и сразу вопрос о первой теме из списка.',
    );
  }
  return L.join('\n');
}

/** Как называть круглую дату по-человечески. */
const MILESTONE_WORD: Record<number, string> = { 7: 'неделя', 30: 'месяц', 365: 'год', 730: 'два года' };

/** Окно круглой даты: человек мог не зайти в сам день — отмечаем до 3 дней спустя (G). */
export const MILESTONE_WINDOW_DAYS = 3;

/** Какая круглая дата сейчас в окне (чистая). */
export function milestoneInWindow(days: number): { m: number; ago: number } | null {
  const m = [...BOND_MILESTONES].reverse().find((x) => days >= x && days - x <= MILESTONE_WINDOW_DAYS);
  return m ? { m, ago: days - m } : null;
}

/** Круглая дата в окне и ещё не отмечена — запомнить, что предложили (журнал FollowUpLog). */
async function openMilestone(userId: string, days: number, now: Date): Promise<{ m: number; ago: number } | null> {
  const w = milestoneInWindow(days);
  if (!w) return null;
  const refKey = `milestone:${w.m}`;
  const log = await prisma.followUpLog.findUnique({ where: { userId_refKey: { userId, refKey } }, select: { closedAt: true } }).catch(() => null);
  if (log?.closedAt) return null;
  if (!log) await prisma.followUpLog.create({ data: { userId, refKey, offeredAt: now, text: `${w.m} дней знакомства` } }).catch(() => null);
  return w;
}

/** Слова, по которым видно, что робот отметил дату: число или «месяц/год/неделя». */
export function celebratesMilestone(m: number, reply: string): boolean {
  const words: Record<number, RegExp> = {
    7: /недел/i,
    30: /месяц/i,
    365: /(?:^|[^а-яё])год(?![а-яё])/i,
    730: /(?:два|2)\s+года/i,
  };
  return new RegExp(`(?:^|\\D)${m}(?:\\D|$)`).test(reply) || (words[m]?.test(reply) ?? false);
}

/** После ответа робота: отметил круглую дату — закрыть, больше не напоминать. */
export async function markMilestoneCelebrated(userId: string, reply: string, now: Date = new Date()): Promise<boolean> {
  try {
    const open = await prisma.followUpLog.findFirst({
      where: { userId, closedAt: null, refKey: { startsWith: 'milestone:' } },
      select: { id: true, refKey: true },
    });
    if (!open) return false;
    const m = Number(open.refKey.slice('milestone:'.length));
    if (!celebratesMilestone(m, reply)) return false;
    await prisma.followUpLog.update({ where: { id: open.id }, data: { askedAt: now, closedAt: now } });
    return true;
  } catch {
    return false;
  }
}

export async function gatherBond(userId: string, now: Date = new Date()): Promise<string | null> {
  try {
    const [user, tz] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, settings: true, therapeuticMode: true } }),
      getUserTimezone(userId),
    ]);
    if (!user) return null;
    const today = localDateOnlyUTC(tz, now);
    const created = localDateOnlyUTC(tz, user.createdAt);
    const days = daysTogether(created, today);
    // E: личные расспросы — только если человек их не выключил.
    const checkIns = ((user.settings ?? {}) as { checkIns?: unknown }).checkIns !== false;
    const quiet: BondFacts['quiet'] = user.therapeuticMode === false ? 'no-support' : !checkIns ? 'no-checkins' : undefined;
    const newcomer = days <= ACQUAINTANCE_DAYS && !quiet;
    const [thread, diary, known, journey] = await Promise.all([
      quiet ? Promise.resolve(null) : currentFollowUp(userId, tz, now),
      prisma.robotDiaryEntry.findFirst({
        where: { userId, day: { lt: today, gte: new Date(today.getTime() - 3 * DAY_MS) } },
        orderBy: { day: 'desc' },
        select: { text: true },
      }),
      newcomer
        ? Promise.all([
            prisma.entity.count({ where: { userId, type: 'person' } }),
            prisma.memory.findMany({
              where: { userId, type: { not: 'message' }, OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] },
              select: { type: true, content: true },
              take: 300,
            }),
            prisma.yearlyGoal.count({ where: { userId } }),
          ]).then(([people, memories, goals]) => ({ people, memories, goals }))
        : Promise.resolve(null),
      days >= 7 ? gatherJourney(userId, tz, now) : Promise.resolve(null),
    ]);
    const diaryText = diary?.text ? diary.text.replace(/\s+/g, ' ').trim() : null;
    const ms = await openMilestone(userId, days, now);
    return formatBondSection({
      days,
      since: created,
      milestone: ms?.m ?? null,
      milestoneAgo: ms?.ago,
      journey,
      thread: thread ? { ...thread, text: annotateRelativeDates(thread.text, localDateStr(tz, now)) } : null,
      unknown: known ? unknownTopics(known).map((t) => ACQUAINTANCE_TOPICS[t]) : undefined,
      quiet,
      diary: diaryText ? (diaryText.length > DIARY_MAX_CHARS ? `${diaryText.slice(0, DIARY_MAX_CHARS - 1)}…` : diaryText) : null,
    });
  } catch (err) {
    console.warn('[bond] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
