/**
 * Робот-друг №4: уровень дружбы. Растёт от того, что мы вместе делаем: дни,
 * когда человек говорил с роботом, закрытые задачи, отмеченные привычки,
 * записи в дневнике. Считается из уже накопленных данных (без отдельного
 * счётчика — не разъедется) и потому никогда не падает: пропуск дня ничего
 * не отнимает, давления «ты меня бросил» нет.
 *
 * Каждый новый уровень открывает подарок для комнаты (room-catalog FRIEND_KINDS).
 * О новом уровне робот говорит один раз: виденный уровень — в User.settings.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isValidIanaTz } from '../lib/tz.js';
import { captureActivity } from './tool-activity-summary.js';
import { FRIEND_KINDS, type FriendKind } from './room-catalog.js';

export const FRIEND_POINTS = { talkDay: 10, task: 2, habit: 1, journal: 3 } as const;

/** Уровни: порог очков и название. Уровень 1 — с первого дня. */
export const FRIEND_LEVELS = [
  { level: 1, title: 'Знакомые', at: 0 },
  { level: 2, title: 'Приятели', at: 50 },
  { level: 3, title: 'Друзья', at: 150 },
  { level: 4, title: 'Хорошие друзья', at: 350 },
  { level: 5, title: 'Близкие друзья', at: 700 },
  { level: 6, title: 'Лучшие друзья', at: 1200 },
] as const;

export interface FriendshipCounts {
  talkDays: number;
  tasks: number;
  habits: number;
  journal: number;
}

export interface Friendship {
  level: number;
  title: string;
  points: number;
  /** Следующий уровень; null — максимальный. */
  next: { level: number; title: string; at: number } | null;
  /** 0..1 — путь до следующего уровня. */
  progress: number;
  counts: FriendshipCounts;
  unlocks: Array<{ key: string; label: string; emoji: string; minLevel: number; unlocked: boolean }>;
}

export function friendshipPoints(c: FriendshipCounts): number {
  return c.talkDays * FRIEND_POINTS.talkDay + c.tasks * FRIEND_POINTS.task + c.habits * FRIEND_POINTS.habit + c.journal * FRIEND_POINTS.journal;
}

export function friendshipFrom(c: FriendshipCounts, peak = 0): Friendship {
  const points = Math.max(friendshipPoints(c), peak);
  const cur = [...FRIEND_LEVELS].reverse().find((l) => points >= l.at) ?? FRIEND_LEVELS[0];
  const next = FRIEND_LEVELS.find((l) => l.level === cur.level + 1) ?? null;
  const progress = next ? Math.min(1, (points - cur.at) / (next.at - cur.at)) : 1;
  return {
    level: cur.level,
    title: cur.title,
    points,
    next: next ? { level: next.level, title: next.title, at: next.at } : null,
    progress,
    counts: c,
    unlocks: (Object.keys(FRIEND_KINDS) as FriendKind[]).map((k) => ({
      key: `friend:${k}`,
      label: FRIEND_KINDS[k].label,
      emoji: FRIEND_KINDS[k].emoji,
      minLevel: FRIEND_KINDS[k].minLevel,
      unlocked: cur.level >= FRIEND_KINDS[k].minLevel,
    })),
  };
}

export function titleOfLevel(level: number): string {
  return FRIEND_LEVELS.find((l) => l.level === level)?.title ?? FRIEND_LEVELS[0].title;
}

export async function friendshipCounts(userId: string): Promise<FriendshipCounts> {
  const raw = await getUserTimezone(userId);
  const tz = isValidIanaTz(raw) ? raw : 'UTC';
  const [days, tasks, habits, journal] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date)::int AS n
      FROM "ChatMessage" WHERE "userId" = ${userId} AND role = 'user'`),
    prisma.task.count({ where: { userId, completed: true, cancelled: false } }),
    prisma.habitLog.count({ where: { userId, completed: true } }),
    prisma.journalEntry.count({ where: { userId } }),
  ]);
  return { talkDays: days[0]?.n ?? 0, tasks, habits, journal };
}

/**
 * Пик очков: читаем из settings, растим атомарно (jsonb_set + условие), чтобы
 * параллельная правка профиля не затёрла его и он не откатился назад.
 */
async function friendPeak(userId: string, live: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ peak: number | null }>>(Prisma.sql`
    SELECT (settings->>'friendPeak')::int AS peak FROM "User" WHERE id = ${userId}`);
  const peak = rows[0]?.peak ?? 0;
  if (live > peak) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "User"
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{friendPeak}', to_jsonb(${live}::int))
      WHERE id = ${userId} AND COALESCE((settings->>'friendPeak')::int, 0) < ${live}`);
    return live;
  }
  return peak;
}

export async function getFriendship(userId: string): Promise<Friendship> {
  const counts = await friendshipCounts(userId);
  const peak = await friendPeak(userId, friendshipPoints(counts)).catch(() => 0);
  return friendshipFrom(counts, peak);
}

/** Строка для мозга: робот знает, насколько вы близки, и не выдумывает. */
export async function friendshipContextLine(userId: string): Promise<string | null> {
  const f = await getFriendship(userId);
  return `Уровень дружбы с роботом: «${f.title}» (${f.level} из ${FRIEND_LEVELS.length})`;
}

/** Фраза о новом уровне — один раз (без давления и упрёков). */
export function levelUpMessage(f: Friendship, name: string | null): string {
  const hey = name ? `${name.trim().split(/\s+/)[0]}, ` : '';
  const gift = f.unlocks.find((u) => u.minLevel === f.level);
  const giftLine = gift ? ` В «Обставить» → «Дружба» для тебя открылся подарок: ${gift.label.toLowerCase()} ${gift.emoji}.` : '';
  return `${hey}мы стали ближе — теперь мы «${f.title}» 💛${giftLine}`;
}

/**
 * Есть ли новый уровень, о котором робот ещё не сказал. Отмечает его виденным
 * (первый вызов для нового юзера только запоминает уровень, без поздравления).
 */
export async function takeLevelUp(userId: string, f: Friendship): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true, name: true } });
  if (!u) return null;
  const settings = (u.settings ?? {}) as Record<string, unknown>;
  const seen = typeof settings.friendLevelSeen === 'number' ? settings.friendLevelSeen : null;
  if (seen !== null && f.level <= seen) return null;
  // Атомарно, только своё поле: целый settings из памяти затёр бы friendPeak
  // и параллельную правку профиля.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{friendLevelSeen}', to_jsonb(${f.level}::int))
    WHERE id = ${userId}`);
  if (seen === null && f.level === 1) return null;
  captureActivity(userId, { type: 'friendship_level', content: `Уровень дружбы с роботом вырос: «${f.title}»`, importance: 4 });
  return levelUpMessage(f, u.name);
}
