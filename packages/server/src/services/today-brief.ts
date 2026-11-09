/**
 * Утренний бриф на сегодня — ОДИН текст для пуша и для приложения.
 * Раньше мозг писал бриф (бюджет, долги, перегруз, темп целей) только в пуш,
 * а в приложении утром была общая фраза «Доброе утро! Чем помочь?» — кто не
 * открыл пуш, брифа не видел (аудит проводки 2026-11-08).
 * Кэш на день в памяти процесса (Railway — один инстанс; рестарт → пересчёт).
 */
import { prisma } from '../lib/prisma.js';
import { localDateStr, localHour } from '../lib/tz.js';
import { withTimeout } from '../lib/with-timeout.js';
import { buildMorning } from './proactive-notifications.js';
import { composeMorningBrief } from './morning-brief.js';

export interface TodayBrief {
  title: string;
  text: string;
  /** День брифа (по поясу юзера): приложение не покажет вчерашний из офлайн-кэша. */
  day?: string;
  /** Новичок: о нём ещё ничего нет — вместо пустого брифа знакомство (чипы-подсказки в приложении). */
  firstDay?: boolean;
}

/**
 * Первые 60 секунд (Berik 2026-11-09): новичок после знакомства попадал в
 * пустое приложение, а бриф говорил «нет срочных задач». Пока о человеке ничего
 * нет (ни дел, ни привычек, ни целей, ни трат, ни одного слова роботу) — робот
 * знакомится: просит одной фразой дела, привычку и мечту и раскладывает их сам.
 */
export async function isNewcomer(userId: string): Promise<boolean> {
  const [tasks, habits, goals, expenses, said] = await Promise.all([
    prisma.task.count({ where: { userId } }),
    prisma.habit.count({ where: { userId } }),
    prisma.yearlyGoal.count({ where: { userId } }),
    prisma.expense.count({ where: { userId } }),
    prisma.chatMessage.count({ where: { userId, role: 'user' } }),
  ]);
  return tasks + habits + goals + expenses + said === 0;
}

export function firstDayBrief(name: string | null | undefined, hour: number): TodayBrief {
  const who = name?.trim() ? `, ${name.trim()}` : '';
  return {
    title: `${greetingForHour(hour)}${who}!`,
    text:
      'Я пока ничего о тебе не знаю — давай за минуту это исправим. ' +
      'Расскажи одной фразой: что нужно сделать на этой неделе, какую привычку хочешь завести и о чём мечтаешь в этом году. ' +
      'Я сам всё разложу по задачам, привычкам и целям — и буду держать это в голове за тебя.',
    firstDay: true,
  };
}

const cache = new Map<string, { day: string; brief: TodayBrief }>();
const MAX_CACHE = 5000;

/** Планировщик сочинил бриф для пуша — запомнить, чтобы приложение показало тот же. */
export function rememberBrief(userId: string, day: string, brief: TodayBrief): void {
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(userId, { day, brief });
}

/** Приветствие по часу юзера: бриф дня открывают и вечером. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

const MORNING_RE = /^Доброе утро/;

/**
 * Первое открытие за день — не обязательно утром (Berik 2026-11-09: в 17:26
 * приложение сказало «Доброе утро»). Кэш хранит утренний текст пуша, а
 * приветствие в начале заголовка и текста меняем по часу на момент показа.
 */
function withTimeOfDay(brief: TodayBrief, hour: number): TodayBrief {
  const hello = greetingForHour(hour);
  return { ...brief, title: brief.title.replace(MORNING_RE, hello), text: brief.text.replace(MORNING_RE, hello) };
}

export async function getTodayBrief(userId: string, now: Date = new Date()): Promise<TodayBrief> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, timezone: true } });
  const tz = user?.timezone || 'UTC';
  const day = localDateStr(tz, now);
  const hour = localHour(tz, now);
  // Новичку — знакомство, не пустой бриф. Не кэшируем: рассказал — и следующий бриф уже настоящий.
  if (await isNewcomer(userId)) return { ...firstDayBrief(user?.name, hour), day };
  const hit = cache.get(userId);
  if (hit && hit.day === day) return { ...withTimeOfDay(hit.brief, hour), day };
  const [n] = await buildMorning(userId, user?.name ?? 'друг', now, tz);
  const text = await withTimeout(composeMorningBrief(userId, n.body, now), 10_000, n.body).catch(() => n.body);
  const brief = { title: n.title, text };
  rememberBrief(userId, day, brief);
  return { ...withTimeOfDay(brief, hour), day };
}
