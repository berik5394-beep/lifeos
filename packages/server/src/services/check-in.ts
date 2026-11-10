/**
 * Робот-друг, пункт 2: «Как ты?» без повода. Раньше робот писал сам почти
 * только про дела (задачи, цели, деньги, долги). Теперь раз в полтора дня —
 * тёплый вопрос про жизнь, лучше из памяти («как прошла встреча с мамой?»).
 *
 * Бережность: не чаще раза в 1,5 дня; не пишем, если человек сам говорил с
 * роботом последние 12 ч (это уже не «без повода»); выключается в
 * настройках (User.settings.checkIns=false). Вопрос по памяти генерирует
 * Haiku под гардами (только факты воспоминания, без чисел-выдумок, коротко,
 * вопросом) — иначе простой «как ты сегодня?».
 */
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { withTimeout } from '../lib/with-timeout.js';
import { numbersHonest } from '../lib/number-honesty.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Не чаще. */
export const CHECK_IN_EVERY_DAYS = 1.5;
/** Человек сам писал роботу недавно — «без повода» уже не нужно. */
export const RECENT_CHAT_HOURS = 12;
/** Воспоминания для вопроса: не совсем свежие (уже обсудили) и не старые. */
const MEMORY_MIN_AGE_MS = 12 * HOUR_MS;
const MEMORY_MAX_AGE_MS = 10 * DAY_MS;
const ASK_TIMEOUT_MS = 6000;

/** Простые вопросы без повода (по кругу по дню года — не одно и то же). */
export const GENERIC_CHECK_INS = [
  'Как ты сегодня — не про дела, а по-настоящему?',
  'Как спалось? Как настроение?',
  'Что сегодня было хорошего, хоть мелочь?',
  'Как ты? Если хочется просто поговорить — я тут.',
  'Чем бы тебе хотелось порадовать себя на этой неделе?',
] as const;

export function genericCheckIn(now: Date = new Date()): string {
  const day = Math.floor(now.getTime() / DAY_MS);
  return GENERIC_CHECK_INS[day % GENERIC_CHECK_INS.length];
}

/** Вопрос годится: короткий, вопросом, без чисел, которых нет в воспоминании. */
export function checkInQuestionOk(q: string, memory: string): boolean {
  const t = q.trim();
  return t.length >= 8 && t.length <= 160 && t.endsWith('?') && !t.includes('\n') && numbersHonest(t, memory);
}

export async function checkInsEnabled(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const s = (u?.settings ?? {}) as { checkIns?: unknown };
  return s.checkIns !== false;
}

export async function chattedRecently(userId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.chatMessage.findFirst({
    where: { userId, role: 'user', createdAt: { gte: new Date(now.getTime() - RECENT_CHAT_HOURS * HOUR_MS) } },
    select: { id: true },
  });
  return row !== null;
}

/** Самое важное свежее личное воспоминание (не журнал действий, не забытое). */
export async function pickCheckInMemory(
  userId: string,
  now: Date = new Date(),
  /** H (2026-11-10): уже поднятое роботом в чате — не повторять пушем. */
  excludeIds: string[] = [],
): Promise<{ id: string; type: string; content: string } | null> {
  return prisma.memory.findFirst({
    where: {
      userId,
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      type: { in: ['event', 'person', 'emotion', 'fact', 'decision'] },
      source: { not: 'v2-episodic' },
      importance: { gte: 5 },
      createdAt: { gte: new Date(now.getTime() - MEMORY_MAX_AGE_MS), lte: new Date(now.getTime() - MEMORY_MIN_AGE_MS) },
      OR: [{ invalidAt: null }, { invalidAt: { gt: now } }],
    },
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, type: true, content: true },
  });
}

const STYLE_HINT: Record<string, string> = {
  friendly: 'тепло, по-дружески',
  strict: 'коротко и по-доброму, без нравоучений',
  calm: 'спокойно и мягко',
  toxic: 'с лёгкой иронией, но заботливо — без подколок и стыда',
};

/** Один тёплый вопрос по воспоминанию. null — не вышло/не прошёл гард (тогда простой вопрос). */
export async function composeCheckInQuestion(userId: string, memory: string): Promise<string | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { name: true, assistantStyle: true } })
    .catch(() => null);
  const ask = async (): Promise<string | null> => {
    const resp = await createAnthropic(apiKey).messages.create({
      model: MODELS.haiku,
      max_tokens: 120,
      system:
        `Ты — LifeOS, робот-друг${user?.name ? ` пользователя ${user.name.split(/\s+/)[0]}` : ''}. ` +
        `Напиши ОДИН короткий тёплый вопрос (до 120 символов) по воспоминанию ниже — как друг, который вспомнил и интересуется. ` +
        `Тон: ${STYLE_HINT[user?.assistantStyle ?? 'friendly'] ?? STYLE_HINT.friendly}. ` +
        'Не про задачи, деньги и продуктивность; без советов и оценок. Если тема тяжёлая (болезнь, утрата, ссора) — очень бережно. ' +
        'Не выдумывай деталей, которых нет в воспоминании. Только вопрос, по-русски, без кавычек и эмодзи.',
      messages: [{ role: 'user', content: `Воспоминание: ${memory}` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text.trim() : null;
  };
  const q = await withTimeout(ask().catch(() => null), ASK_TIMEOUT_MS, null);
  return q && checkInQuestionOk(q, memory) ? q : null;
}
