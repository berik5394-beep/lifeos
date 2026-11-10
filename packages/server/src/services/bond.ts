/**
 * «Наша связь» — характер разговора друга (Berik 2026-11-10, анализ Replika:
 * docs/plan/replika-analysis-2026-11.md). Механики дружбы у робота были
 * (память, «как ты?», дневник, уровень), но в разговоре он вёл себя как
 * исполнитель: правило «не упоминай прошлые темы» не давало вспомнить важное.
 *
 * Здесь — блок для мозга:
 *  1. «Наша история»: сколько вы знакомы, круглая дата сегодня;
 *  2. «Незакрытое»: одно личное событие/переживание 12 ч – 10 дн назад, о котором
 *     друг спросил бы «как прошло?» — держится сутки, потом следующее; то, о чём
 *     робот уже спрашивал пушем «как ты?», не повторяем;
 *  3. «Твой дневник»: вчерашняя запись робота — чтобы было чем поделиться
 *     (взаимность — так строится близость, а не только «отвечать и выполнять»).
 * Только факты из БД — ничего не выдумываем. Сбой — null, разговор как раньше.
 */
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateOnlyUTC } from '../lib/tz.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Круглые даты знакомства, которые друг отметит. */
export const BOND_MILESTONES = [7, 30, 50, 100, 200, 365, 500, 730, 1000] as const;
/** Сколько держим одно «незакрытое» в разговоре, прежде чем взять следующее. */
export const THREAD_HOLD_MS = DAY_MS;
const THREAD_MIN_AGE_MS = 12 * HOUR_MS;
const THREAD_MAX_AGE_MS = 10 * DAY_MS;
const RETIRED_KEEP = 50;
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

export interface OpenThread {
  id: string;
  firstOfferedAt: string;
}
interface BondSettings {
  openThread?: OpenThread;
  threadsRetired?: string[];
}

/**
 * Какое «незакрытое» держать сейчас. Текущее — пока ему меньше суток и оно
 * живо; иначе — следующее подходящее (не отставленное, не спрошенное пушем).
 * Чистая логика выбора — в pickThread; здесь БД.
 */
async function currentThread(
  userId: string,
  settings: BondSettings,
  now: Date,
): Promise<{ thread: { id: string; content: string } | null; save: BondSettings | null }> {
  const retired = new Set(settings.threadsRetired ?? []);
  const cur = settings.openThread;
  if (cur && now.getTime() - new Date(cur.firstOfferedAt).getTime() < THREAD_HOLD_MS) {
    const m = await prisma.memory.findFirst({
      where: { id: cur.id, userId, OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] },
      select: { id: true, content: true },
    });
    if (m) return { thread: m, save: null };
  }
  if (cur) retired.add(cur.id);
  // Уже спрошено пушем «как ты?» (scopeKey check_in:<memoryId>) — не повторяем в чате.
  const asked = await prisma.insight.findMany({
    where: { userId, kind: 'v2_nudge', scopeKey: { startsWith: 'check_in:' }, createdAt: { gte: new Date(now.getTime() - THREAD_MAX_AGE_MS) } },
    select: { scopeKey: true },
  });
  for (const a of asked) if (a.scopeKey) retired.add(a.scopeKey.slice('check_in:'.length));
  const next = await prisma.memory.findFirst({
    where: {
      userId,
      // Событие или переживание — то, про что спрашивают «как прошло?»
      type: { in: ['event', 'emotion'] },
      source: { not: 'v2-episodic' },
      importance: { gte: 5 },
      createdAt: { gte: new Date(now.getTime() - THREAD_MAX_AGE_MS), lte: new Date(now.getTime() - THREAD_MIN_AGE_MS) },
      OR: [{ invalidAt: null }, { invalidAt: { gt: now } }],
      ...(retired.size > 0 ? { id: { notIn: [...retired] } } : {}),
    },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, content: true },
  });
  const retiredList = [...retired].slice(-RETIRED_KEEP);
  const save: BondSettings = next
    ? { openThread: { id: next.id, firstOfferedAt: now.toISOString() }, threadsRetired: retiredList }
    : { threadsRetired: retiredList };
  return { thread: next, save: cur || next ? save : null };
}

/** Атомарно дописать ключи в User.settings (не затирая чужие). */
async function mergeSettings(userId: string, patch: BondSettings): Promise<void> {
  const json = JSON.stringify(patch);
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "User" SET settings = COALESCE(settings::jsonb, '{}'::jsonb) - 'openThread' || ${json}::jsonb WHERE id = ${userId}`,
  );
}

export interface BondFacts {
  days: number;
  since: Date;
  milestone: number | null;
  thread: string | null;
  diary: string | null;
  /** Знакомство (первая неделя): о чём робот ещё не знает. Пусто/нет — уже знакомы. */
  unknown?: string[];
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
  if (f.milestone) L.push(`Сегодня ровно ${daysWord(f.milestone)} знакомства — тепло отметь это один раз, коротко, без пафоса.`);
  if (f.thread) {
    L.push(
      `Незакрытое из ваших разговоров: «${f.thread}». Друг спросил бы, как прошло — спроси одной фразой после ответа, ` +
        'если разговор не про срочное дело и ты ещё не спрашивал об этом в истории диалога.',
    );
  }
  if (f.diary) L.push(`Твоя запись в дневнике (можно поделиться к месту, от первого лица): «${f.diary}»`);
  if (f.unknown && f.unknown.length > 0) {
    L.push(
      `Вы ещё знакомитесь. Ты пока не знаешь: ${f.unknown.join('; ')}. В личном разговоре (не в деловых командах) после ответа ` +
        'спроси об ОДНОЙ из этих тем — живо, с интересом, своими словами, не анкетой и не списком. Ответит — запомнится само; ' +
        'не переспрашивай то, что он уже рассказал в этом разговоре. Просит «давай познакомимся» — одна тёплая фраза о себе (без перечня функций и без вопросов про приложение) и сразу вопрос о первой теме из списка.',
    );
  }
  return L.join('\n');
}

export async function gatherBond(userId: string, now: Date = new Date()): Promise<string | null> {
  try {
    const [user, tz] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, settings: true } }),
      getUserTimezone(userId),
    ]);
    if (!user) return null;
    const today = localDateOnlyUTC(tz, now);
    const created = localDateOnlyUTC(tz, user.createdAt);
    const days = daysTogether(created, today);
    const settings = (user.settings ?? {}) as BondSettings;
    const newcomer = days <= ACQUAINTANCE_DAYS;
    const [{ thread, save }, diary, known] = await Promise.all([
      currentThread(userId, settings, now),
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
    ]);
    if (save) await mergeSettings(userId, save).catch(() => {});
    const diaryText = diary?.text ? diary.text.replace(/\s+/g, ' ').trim() : null;
    return formatBondSection({
      days,
      since: created,
      milestone: (BOND_MILESTONES as readonly number[]).includes(days) ? days : null,
      thread: thread?.content ?? null,
      unknown: known ? unknownTopics(known).map((t) => ACQUAINTANCE_TOPICS[t]) : undefined,
      diary: diaryText ? (diaryText.length > DIARY_MAX_CHARS ? `${diaryText.slice(0, DIARY_MAX_CHARS - 1)}…` : diaryText) : null,
    });
  } catch (err) {
    console.warn('[bond] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
