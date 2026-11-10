/**
 * Дневник робота (робот-друг №3). У Replika есть свой дневник — кажется, что
 * у неё есть «внутренняя жизнь». Здесь робот от первого лица пишет 2–3 тёплые
 * фразы о дне человека — СТРОГО по фактам дня из БД (задачи, привычки,
 * дневник самочувствия, о чём говорили, встречи).
 *
 * Честность: нет фактов — нет записи (не выдумываем день). Текст модели
 * проходит гард чисел; иначе — простая запись из фактов. Одна запись на день,
 * написанное не переписываем. Пишется при открытии дневника (вчера + сегодня
 * вечером) — платим только за то, что человек читает.
 */
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { withTimeout } from '../lib/with-timeout.js';
import { numbersHonest } from '../lib/number-honesty.js';
import { getUserTimezone } from '../lib/user-context.js';
import { addCivilDays, dateOnlyUTC, localDateStr, localDayStartUTCOffset, localHour } from '../lib/tz.js';

/** Сегодняшнюю запись пишем не раньше вечера (день ещё идёт). */
export const TODAY_FROM_HOUR = 18;
const WRITE_TIMEOUT_MS = 8000;
const LIST_LIMIT = 30;

export interface DayFacts {
  day: string; // YYYY-MM-DD
  tasksDone: string[];
  tasksOpen: number;
  habitsDone: string[];
  journal: { sleepHours: number | null; mood: number | null; energy: number | null; notes: string | null } | null;
  talkedTimes: number;
  remembered: string[];
  events: string[];
}

export function hasAnything(f: DayFacts): boolean {
  return (
    f.tasksDone.length > 0 ||
    f.habitsDone.length > 0 ||
    f.journal !== null ||
    f.talkedTimes > 0 ||
    f.remembered.length > 0 ||
    f.events.length > 0
  );
}

const short = (s: string, max = 80) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Факты дня строками — их же видит модель и по ним же гард чисел. */
export function factLines(f: DayFacts): string[] {
  const out: string[] = [];
  if (f.tasksDone.length) out.push(`закрыто задач: ${f.tasksDone.length} (${f.tasksDone.slice(0, 3).map((t) => `«${short(t, 40)}»`).join(', ')})`);
  if (f.tasksOpen > 0) out.push(`осталось задач на день: ${f.tasksOpen}`);
  if (f.habitsDone.length) out.push(`привычки: ${f.habitsDone.slice(0, 4).join(', ')}`);
  if (f.journal) {
    const j = f.journal;
    const parts = [
      j.sleepHours != null ? `сон ${j.sleepHours} ч` : null,
      j.mood != null ? `настроение ${j.mood}/10` : null,
      j.energy != null ? `энергия ${j.energy}/10` : null,
    ].filter(Boolean);
    if (parts.length) out.push(`дневник: ${parts.join(', ')}`);
    if (j.notes?.trim()) out.push(`запись в дневнике: «${short(j.notes)}»`);
  }
  if (f.events.length) out.push(`встречи: ${f.events.slice(0, 3).map((e) => `«${short(e, 40)}»`).join(', ')}`);
  if (f.remembered.length) out.push(`запомнил из разговора: ${f.remembered.slice(0, 3).map((m) => `«${short(m)}»`).join('; ')}`);
  if (f.talkedTimes > 0) out.push(`мы разговаривали (сообщений: ${f.talkedTimes})`);
  return out;
}

/** Честная запись без модели — из тех же фактов, от первого лица. */
export function factsEntry(f: DayFacts): string {
  const bits: string[] = [];
  // Пол человека неизвестен — без «закрыл/закрыла».
  const n = f.tasksDone.length;
  const h = f.habitsDone.length;
  if (n) bits.push(`${n} ${plural(n, 'задача закрыта', 'задачи закрыты', 'задач закрыто')}`);
  if (h) bits.push(`${h} ${plural(h, 'привычка отмечена', 'привычки отмечены', 'привычек отмечено')}`);
  if (f.events.length) bits.push(f.events.length === 1 ? 'была встреча' : 'были встречи');
  const head = bits.length ? `За день: ${bits.join(', ')}.` : 'Сегодня мы немного поговорили.';
  const mood = f.journal?.mood;
  const moodLine = mood == null ? '' : mood <= 4 ? ' По дневнику день был непростой — надеюсь, завтра будет легче.' : mood >= 8 ? ' По дневнику — хороший день, я рад.' : '';
  const told = f.remembered.length ? ` Я запомнил: «${short(f.remembered[0])}».` : '';
  return `${head}${moodLine}${told}`.trim();
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export async function gatherDayFacts(userId: string, tz: string, daysAgo: number, now: Date = new Date()): Promise<DayFacts> {
  const day = addCivilDays(localDateStr(tz, now), -daysAgo);
  const dayDate = dateOnlyUTC(day);
  const from = localDayStartUTCOffset(tz, daysAgo, now);
  const to = localDayStartUTCOffset(tz, daysAgo - 1, now);
  const [tasks, logs, journal, chats, memories, events] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: dayDate, cancelled: false, parentId: null }, select: { title: true, completed: true } }),
    prisma.habitLog.findMany({ where: { userId, date: dayDate, completed: true }, select: { habit: { select: { name: true } } } }),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dayDate } }, select: { sleepHours: true, mood: true, energy: true, notes: true } }),
    prisma.chatMessage.count({ where: { userId, role: 'user', crisis: false, createdAt: { gte: from, lt: to } } }),
    prisma.memory.findMany({
      where: {
        userId,
        type: { in: ['event', 'person', 'emotion', 'fact', 'decision', 'preference'] },
        source: { not: 'v2-episodic' },
        createdAt: { gte: from, lt: to },
        OR: [{ invalidAt: null }, { invalidAt: { gt: now } }],
      },
      orderBy: { importance: 'desc' },
      take: 3,
      select: { content: true },
    }),
    prisma.calendarEvent.findMany({ where: { userId, date: dayDate }, select: { title: true }, take: 5 }),
  ]);
  return {
    day,
    tasksDone: tasks.filter((t) => t.completed).map((t) => t.title),
    tasksOpen: tasks.filter((t) => !t.completed).length,
    habitsDone: logs.map((l) => l.habit.name),
    journal: journal,
    talkedTimes: chats,
    remembered: memories.map((m) => m.content),
    events: events.map((e) => e.title),
  };
}

/** Запись от лица робота (Haiku) под гардом; null — пишем из фактов. */
export async function writeDiaryText(name: string, style: string, f: DayFacts): Promise<string | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  const facts = factLines(f);
  const STYLE: Record<string, string> = {
    friendly: 'тепло, с лёгким юмором',
    strict: 'сдержанно, но по-доброму',
    calm: 'спокойно, вдумчиво',
    toxic: 'с иронией, но без злобы — это личный дневник',
  };
  const ask = async (): Promise<string | null> => {
    const resp = await createAnthropic(apiKey).messages.create({
      model: MODELS.haiku,
      max_tokens: 220,
      system:
        `Ты — LifeOS, робот-друг. Пишешь СВОЙ личный дневник о дне человека по имени ${name}. ` +
        `2–3 коротких предложения от первого лица («я заметил», «мне показалось»), о человеке — по имени. Пол человека неизвестен: не используй формы с родом («закрыл/закрыла», «он/она»), пиши «у ${name} получилось», «${name} справляется». ` +
        `Тон: ${STYLE[style] ?? STYLE.friendly}. Тепло, без оценок, советов и нравоучений; если день тяжёлый — бережно. ` +
        'Используй ТОЛЬКО факты ниже: не выдумывай событий, чисел, людей и чувств, которых нет в фактах. Без markdown и эмодзи.',
      messages: [{ role: 'user', content: `Факты дня:\n${facts.map((x) => `- ${x}`).join('\n')}` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text.trim() : null;
  };
  const text = await withTimeout(ask().catch(() => null), WRITE_TIMEOUT_MS, null);
  if (!text || text.length > 600 || !numbersHonest(text, facts.join('\n'))) return null;
  return text;
}

/** Записать день, если записи ещё нет и в дне что-то было. Гонку двух открытий держит unique(userId, day). */
export async function ensureDiaryEntry(userId: string, tz: string, daysAgo: number, now: Date = new Date()): Promise<void> {
  const day = addCivilDays(localDateStr(tz, now), -daysAgo);
  const exists = await prisma.robotDiaryEntry.findUnique({ where: { userId_day: { userId, day: dateOnlyUTC(day) } }, select: { id: true } });
  if (exists) return;
  const facts = await gatherDayFacts(userId, tz, daysAgo, now);
  if (!hasAnything(facts)) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, assistantStyle: true } });
  const name = user?.name?.trim().split(/\s+/)[0] || 'мой человек';
  const ai = await writeDiaryText(name, user?.assistantStyle ?? 'friendly', facts).catch(() => null);
  await prisma.robotDiaryEntry
    .create({ data: { userId, day: dateOnlyUTC(day), text: ai ?? factsEntry(facts), source: ai ? 'ai' : 'facts' } })
    .catch(() => {}); // параллельное открытие уже записало
}

export async function readDiary(userId: string, now: Date = new Date()): Promise<Array<{ day: string; text: string }>> {
  const tz = await getUserTimezone(userId);
  await ensureDiaryEntry(userId, tz, 1, now).catch(() => {});
  if (localHour(tz, now) >= TODAY_FROM_HOUR) await ensureDiaryEntry(userId, tz, 0, now).catch(() => {});
  const rows = await prisma.robotDiaryEntry.findMany({
    where: { userId },
    orderBy: { day: 'desc' },
    take: LIST_LIMIT,
    select: { day: true, text: true },
  });
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), text: r.text }));
}

/** Ночью (по часам человека) пишем вчерашний день — дневник есть, даже если экран не открывали (F, 2026-11-10). */
export const NIGHTLY_FROM_HOUR = 3;
export const NIGHTLY_TO_HOUR = 6;
const NIGHTLY_BATCH = 40;

export function isNightlyDiaryHour(hour: number): boolean {
  return hour >= NIGHTLY_FROM_HOUR && hour < NIGHTLY_TO_HOUR;
}

/**
 * Раньше дневник писался только при открытии экрана дневника — у большинства был
 * пуст, и роботу нечем было делиться в разговоре. Теперь: активные за 3 дня, у
 * кого сейчас 3–6 утра, — запись за вчера (если в дне что-то было и записи нет).
 * Возвращает, сколько записей проверено.
 */
export async function writeNightlyDiaries(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const active = await prisma.userActiveDay.findMany({
    where: { day: { gte: new Date(since.toISOString().slice(0, 10) + 'T00:00:00Z') } },
    select: { userId: true },
    distinct: ['userId'],
    take: 2000,
  });
  let done = 0;
  for (const { userId } of active) {
    if (done >= NIGHTLY_BATCH) break;
    const tz = await getUserTimezone(userId).catch(() => 'Asia/Almaty');
    if (!isNightlyDiaryHour(localHour(tz, now))) continue;
    const yesterday = dateOnlyUTC(addCivilDays(localDateStr(tz, now), -1));
    const exists = await prisma.robotDiaryEntry.findUnique({ where: { userId_day: { userId, day: yesterday } }, select: { id: true } });
    if (exists) continue;
    await ensureDiaryEntry(userId, tz, 1, now).catch((err) => console.warn('[robot-diary] nightly failed:', err instanceof Error ? err.message : err));
    done++;
  }
  return done;
}
