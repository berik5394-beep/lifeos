/**
 * Утренний бриф на сегодня — ОДИН текст для пуша и для приложения.
 * Раньше мозг писал бриф (бюджет, долги, перегруз, темп целей) только в пуш,
 * а в приложении утром была общая фраза «Доброе утро! Чем помочь?» — кто не
 * открыл пуш, брифа не видел (аудит проводки 2026-11-08).
 * Кэш на день в памяти процесса (Railway — один инстанс; рестарт → пересчёт).
 */
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { withTimeout } from '../lib/with-timeout.js';
import { buildMorning } from './proactive-notifications.js';
import { composeMorningBrief } from './morning-brief.js';

export interface TodayBrief {
  title: string;
  text: string;
  /** День брифа (по поясу юзера): приложение не покажет вчерашний из офлайн-кэша. */
  day?: string;
}

const cache = new Map<string, { day: string; brief: TodayBrief }>();
const MAX_CACHE = 5000;

/** Планировщик сочинил бриф для пуша — запомнить, чтобы приложение показало тот же. */
export function rememberBrief(userId: string, day: string, brief: TodayBrief): void {
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(userId, { day, brief });
}

export async function getTodayBrief(userId: string, now: Date = new Date()): Promise<TodayBrief> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, timezone: true } });
  const tz = user?.timezone || 'UTC';
  const day = localDateStr(tz, now);
  const hit = cache.get(userId);
  if (hit && hit.day === day) return { ...hit.brief, day };
  const [n] = await buildMorning(userId, user?.name ?? 'друг', now, tz);
  const text = await withTimeout(composeMorningBrief(userId, n.body, now), 10_000, n.body).catch(() => n.body);
  const brief = { title: n.title, text };
  rememberBrief(userId, day, brief);
  return { ...brief, day };
}
