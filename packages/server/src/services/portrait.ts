/**
 * «Каким я тебя вижу» — портрет человека на экране «Что я о тебе помню»
 * (Berik: «можем ли мы ему рассказать о нём, взяв из чатов и памяти?»).
 *
 * Мозг собирает факты СО ВСЕГО приложения — память (что рассказывал, люди),
 * привычки за месяц, траты, цели, самочувствие из дневника, задачи, манеру
 * общения (оси личности) — и пишет 3–5 предложений от лица робота.
 *
 * Честность: только по фактам; числа в тексте — только из фактов (гард);
 * фактов мало — портрета нет, честно просим рассказать больше. Портрет
 * хранится в User.settings.portrait и пишется заново, когда факты поменялись
 * (не чаще раза в час) — платим только за новое.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { withTimeout } from '../lib/with-timeout.js';
import { numbersHonest } from '../lib/number-honesty.js';
import { expenseCategoryLabel } from '../lib/ru-labels.js';
import { gatherAboutMe } from './about-me.js';
import { getUserAxesStore } from './user-axes/index.js';

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const MIN_FACTS = 4;
const REWRITE_MIN_MS = 60 * 60_000;
const WRITE_TIMEOUT_MS = 20_000;
const MAX_TEXT = 900;

export type PortraitStatus = 'ok' | 'need_more' | 'unavailable';
export interface Portrait {
  status: PortraitStatus;
  text: string | null;
  updatedAt: string | null;
  /** Сколько фактов легло в основу. */
  basedOn: number;
}

interface Stored {
  text: string;
  at: string;
  sig: string;
}

const short = (s: string, max = 90) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Слова вместо чисел осей личности — только при достаточном числе сигналов. */
export function axesWords(a: {
  selfDiscipline: number;
  emotionalOpenness: number;
  conflictTolerance: number;
  introspectionDepth: number;
  signalCount: number;
}): string[] {
  if (a.signalCount < 15) return [];
  const out: string[] = [];
  const hi = 0.65;
  const lo = 0.35;
  if (a.selfDiscipline >= hi) out.push('собранность: держит слово и доводит дела');
  else if (a.selfDiscipline <= lo) out.push('собранность: дела часто откладываются');
  if (a.emotionalOpenness >= hi) out.push('открыто говорит о чувствах');
  else if (a.emotionalOpenness <= lo) out.push('о чувствах говорит скупо, больше о делах');
  if (a.conflictTolerance >= hi) out.push('спокойно принимает прямоту и критику');
  else if (a.conflictTolerance <= lo) out.push('резкость задевает — важна мягкость');
  if (a.introspectionDepth >= hi) out.push('любит разбираться в себе');
  return out;
}

/** Факты обо всём человеке строками — их видит модель, по ним же гард чисел. */
export async function gatherPortraitFacts(userId: string, now: Date = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const since14 = new Date(now.getTime() - 14 * DAY);
  const [about, habits, logs, spend, goals, journal, tasks, axes] = await Promise.all([
    gatherAboutMe(userId, now),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true }, take: 12 }),
    prisma.habitLog.groupBy({ by: ['habitId'], where: { userId, completed: true, date: { gte: since } }, _count: { _all: true } }),
    prisma.expense.groupBy({ by: ['category'], where: { userId, date: { gte: since } }, _sum: { amount: true } }),
    prisma.yearlyGoal.findMany({ where: { userId, year: now.getUTCFullYear() }, select: { goalText: true, progress: true }, take: 6 }),
    prisma.journalEntry.findMany({ where: { userId, date: { gte: since14 } }, select: { mood: true, energy: true, sleepHours: true } }),
    prisma.task.findMany({ where: { userId, date: { gte: since14, lte: now } }, select: { completed: true } }),
    getUserAxesStore()
      .getAxes(userId)
      .catch(() => null),
  ]);

  const out: string[] = [];
  for (const f of about.facts.slice(0, 25)) out.push(`из разговоров: ${short(f.content)}`);
  for (const p of about.people.slice(0, 8)) {
    const extra = [...p.relations.slice(0, 1), ...p.facts.slice(0, 2)].join('; ');
    out.push(`близкий человек: ${p.name}${extra ? ` (${short(extra, 70)})` : ''}`);
  }
  const done = new Map(logs.map((l) => [l.habitId, l._count._all]));
  for (const h of habits) out.push(`привычка «${short(h.name, 40)}»: выполнена ${done.get(h.id) ?? 0} из ${WINDOW_DAYS} дней`);
  const spent = spend
    .map((s) => ({ c: s.category, a: Math.round(s._sum.amount ?? 0) }))
    .filter((s) => s.a > 0)
    .sort((x, y) => y.a - x.a);
  const total = spent.reduce((n, s) => n + s.a, 0);
  if (total > 0) {
    out.push(
      `траты за ${WINDOW_DAYS} дней больше всего: ` +
        spent
          .slice(0, 3)
          .map((s) => `${expenseCategoryLabel(s.c).toLowerCase()} ${Math.round((s.a / total) * 100)}%`)
          .join(', '),
    );
  }
  for (const g of goals) out.push(`цель на год: ${short(g.goalText, 70)} (прогресс ${Math.round(g.progress)}%)`);
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length >= 3 ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const mood = avg(journal.map((j) => j.mood));
  const sleep = avg(journal.map((j) => j.sleepHours));
  if (mood !== null) out.push(`настроение в дневнике за 2 недели в среднем ${mood} из 5`);
  if (sleep !== null) out.push(`сон за 2 недели в среднем ${sleep} ч`);
  if (tasks.length >= 3) out.push(`задачи за 2 недели: закрыто ${tasks.filter((t) => t.completed).length} из ${tasks.length}`);
  if (axes) out.push(...axesWords(axes).map((w) => `по разговорам: ${w}`));
  return out;
}

export function factsSignature(facts: string[]): string {
  return createHash('sha256').update(facts.join('\n')).digest('hex').slice(0, 16);
}

/** Текст портрета (Sonnet) под гардом чисел; null — не получилось честно. */
export async function writePortraitText(name: string, style: string, facts: string[]): Promise<string | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  const STYLE: Record<string, string> = {
    friendly: 'тепло, как лучший друг',
    strict: 'прямо и по делу, но с уважением',
    calm: 'спокойно и мудро',
    toxic: 'с иронией, но без злобы и унижения',
  };
  const ask = async (): Promise<string | null> => {
    const resp = await createAnthropic(apiKey).messages.create({
      model: MODELS.sonnet,
      max_tokens: 400,
      system:
        `Ты — LifeOS, робот-друг человека по имени ${name}. Человек спросил: «каким ты меня видишь?». ` +
        'Напиши 3–5 предложений, обращаясь на «ты» и по имени: кто этот человек, что для него важно (люди, дело, цели), ' +
        'какие у него привычки и закономерности (что получается, что даётся трудно), куда уходят силы и деньги. ' +
        'Свяжи факты между собой — увидь закономерность, а не перечисляй. Закончи одной тёплой мыслью или мягким наблюдением, без поучений. ' +
        `Тон: ${STYLE[style] ?? STYLE.friendly}. ` +
        'Пол человека неизвестен: не используй формы с родом («сделал/сделала», «он/она»). ' +
        'Используй ТОЛЬКО факты ниже: не выдумывай людей, событий, чисел и черт характера, которых в фактах нет. ' +
        'Никаких диагнозов. Числа — только те, что есть в фактах, и не больше двух. Без markdown, списков и эмодзи.',
      messages: [{ role: 'user', content: `Факты:\n${facts.map((x) => `- ${x}`).join('\n')}` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text.trim() : null;
  };
  const text = await withTimeout(ask().catch(() => null), WRITE_TIMEOUT_MS, null);
  if (!text || text.length > MAX_TEXT || !numbersHonest(text, facts.join('\n'))) return null;
  return text;
}

function readStored(settings: unknown): Stored | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const p = (settings as Record<string, unknown>).portrait;
  if (!p || typeof p !== 'object') return null;
  const s = p as Partial<Stored>;
  return typeof s.text === 'string' && typeof s.at === 'string' && typeof s.sig === 'string' ? (s as Stored) : null;
}

/**
 * Портрет: сохранённый, если факты не менялись или прошло меньше часа;
 * иначе пишем заново. Мало фактов — need_more; модель не справилась честно —
 * отдаём прежний портрет, а если его нет — unavailable.
 */
export async function getPortrait(userId: string, now: Date = new Date()): Promise<Portrait> {
  const [user, facts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, assistantStyle: true, settings: true } }),
    gatherPortraitFacts(userId, now),
  ]);
  const stored = readStored(user?.settings);
  const basedOn = facts.length;
  if (facts.length < MIN_FACTS) {
    return stored ? { status: 'ok', text: stored.text, updatedAt: stored.at, basedOn } : { status: 'need_more', text: null, updatedAt: null, basedOn };
  }
  const sig = factsSignature(facts);
  const fresh = stored && (stored.sig === sig || now.getTime() - Date.parse(stored.at) < REWRITE_MIN_MS);
  if (stored && fresh) return { status: 'ok', text: stored.text, updatedAt: stored.at, basedOn };

  const name = user?.name?.trim().split(/\s+/)[0] || 'друг';
  const text = await writePortraitText(name, user?.assistantStyle ?? 'friendly', facts).catch(() => null);
  if (!text) {
    return stored ? { status: 'ok', text: stored.text, updatedAt: stored.at, basedOn } : { status: 'unavailable', text: null, updatedAt: null, basedOn };
  }
  const value: Stored = { text, at: now.toISOString(), sig };
  // Атомарно в settings (рядом лежат другие ключи — не затираем их).
  await prisma.$executeRaw`
    UPDATE "User" SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{portrait}', ${JSON.stringify(value)}::jsonb, true)
    WHERE id = ${userId}`.catch(() => 0);
  return { status: 'ok', text, updatedAt: value.at, basedOn };
}

export const PORTRAIT_MIN_FACTS = MIN_FACTS;
export const PORTRAIT_REWRITE_MIN_MS = REWRITE_MIN_MS;
