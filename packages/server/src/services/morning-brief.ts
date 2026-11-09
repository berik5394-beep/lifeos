/**
 * Этап 4: утренний бриф через мозг. Раньше пуш был шаблоном со счётчиками
 * («3 задачи, привычек 0/4…») — без бюджета, долгов, перегруза, темпа целей,
 * настроения и выбранного стиля ассистента.
 *
 * Как устроено (честность прежде всего):
 *  1. Факты собираются детерминированно из БД (gatherBriefExtras) — числа
 *     только отсюда.
 *  2. Haiku лишь пересказывает их в стиле юзера (friendly/strict/calm/toxic,
 *     пол), мягче при спаде настроения.
 *  3. Гард: каждое число в ответе модели обязано быть в фактах; иначе — и
 *     при любом сбое — честный шаблон из тех же фактов.
 * Вызывается ОДИН раз в день — в момент отправки (после дедупа планировщика).
 */
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { localDateOnlyUTC, localMonthOnlyUTC, localWeekStartUTC } from '../lib/tz.js';
import { isV2RunwayEnabled } from '../lib/feature-flags.js';
import { buildRunway } from './runway/index.js';
import { gatherDayLoad } from './day-load.js';
import { computeCapacityFit } from './capacity-fit.js';
import { computeGoalPace, isMoneyGoal } from './goal-pace.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import { gatherKanbanSignals, formatKanbanFacts } from './kanban-signals.js';
import { gatherReflection } from './reflection-context.js';
import { numbersHonest } from '../lib/number-honesty.js';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');

/** Доп. факты дня: бюджет, долги со сроком, перегруз, отстающая цель. Каждый — best-effort. */
export async function gatherBriefExtras(userId: string, tz: string, now: Date = new Date()): Promise<string[]> {
  const today = localDateOnlyUTC(tz, now);
  const monthStart = localMonthOnlyUTC(tz, now);
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const out: string[] = [];

  const [spent, limits, obligations, goals, load, kanban, reflection, income, weekGoals, monthGoals, runway] = await Promise.all([
    prisma.expense.aggregate({ where: { userId, date: { gte: monthStart, lt: nextMonth } }, _sum: { amount: true } }).catch(() => null),
    prisma.budgetLimit
      .aggregate({ where: { userId, month: monthStart.getUTCMonth() + 1, year: monthStart.getUTCFullYear() }, _sum: { monthlyLimit: true } })
      .catch(() => null),
    prisma.obligation
      .findMany({ where: { userId, status: 'open', dueDate: { lte: today } }, orderBy: { dueDate: 'asc' }, take: 3 })
      .catch(() => []),
    prisma.yearlyGoal
      .findMany({ where: { userId, year: monthStart.getUTCFullYear(), target: { not: null }, progress: { lt: 100 } } })
      .catch(() => []),
    gatherDayLoad(userId, now).catch(() => null),
    gatherKanbanSignals(userId, now).catch(() => null),
    gatherReflection(userId, now).catch(() => null),
    // Деньги шире расходов: доход месяца + запас денег (только тревожный).
    prisma.income.aggregate({ where: { userId, date: { gte: monthStart, lt: nextMonth } }, _sum: { amount: true } }).catch(() => null),
    // План недели и месяца (раньше в брифе только одна годовая цель).
    prisma.weeklyGoal.findMany({ where: { userId, weekStart: localWeekStartUTC(tz, now), archivedAt: null }, select: { completed: true } }).catch(() => []),
    prisma.monthlyGoal.findMany({ where: { userId, monthStart }, select: { completed: true } }).catch(() => []),
    isV2RunwayEnabled(userId) ? buildRunway(userId, now).catch(() => null) : Promise.resolve(null),
  ]);

  const limit = limits?._sum.monthlyLimit ?? 0;
  const spentSum = spent?._sum.amount ?? 0;
  if (limit > 0) out.push(`бюджет месяца: потрачено ${fmt(spentSum)} из ${fmt(limit)} ₸ (${Math.round((spentSum / limit) * 100)}%)`);
  const incomeSum = income?._sum.amount ?? 0;
  if (incomeSum > 0) out.push(`доход за месяц: ${fmt(incomeSum)} ₸`);
  if (runway?.insightText) out.push(runway.insightText);
  if (weekGoals.length > 0) out.push(`цели недели: закрыто ${weekGoals.filter((g) => g.completed).length} из ${weekGoals.length}`);
  if (monthGoals.length > 0) out.push(`цели месяца: закрыто ${monthGoals.filter((g) => g.completed).length} из ${monthGoals.length}`);

  for (const o of obligations) {
    const what = o.direction === 'i_owe' ? `отдать ${o.personName}` : `${o.personName} должен вернуть`;
    const sum = o.kind === 'money' && o.amount ? ` ${fmt(o.amount)} ₸` : ` — ${o.description}`;
    const when = o.dueDate && o.dueDate.getTime() < today.getTime() ? 'срок прошёл' : 'срок сегодня';
    out.push(`${when}: ${what}${sum}`);
  }

  if (load && load.items.length > 0) {
    const fit = computeCapacityFit(load);
    if (fit.status === 'overloaded') {
      out.push(`день перегружен: дел на ~${Math.round(fit.totalDemand / 60)} ч, свободно ~${Math.round(fit.capacity / 60)} ч`);
    }
  }

  const behind = goals
    .filter((g) => g.target != null && !isMoneyGoal(g.area, g.target))
    .map((g) => ({ g, p: computeGoalPace({ target: g.target!, targetDate: g.targetDate, progress: g.progress, createdAt: g.createdAt }, now) }))
    .find((x) => x.p.status === 'behind' || x.p.status === 'stalled');
  // Канбан: перебор «В работе» и зависшие задачи (робот следит за доской).
  if (kanban) out.push(...formatKanbanFacts(kanban));
  // Дневник и заметки недели: вчерашнее самочувствие + свой фокус недели.
  if (reflection?.briefLine) out.push(reflection.briefLine);
  if (reflection && reflection.lowStreakDays >= 3) out.push(`${reflection.lowStreakDays} дн. подряд тяжело по дневнику — начни мягко`);

  if (behind) out.push(`цель «${behind.g.goalText}» отстаёт: сделано ${fmt(behind.p.done)} из ${fmt(behind.g.target!)}`);

  return out;
}

/** Модель не добавила чисел, которых нет в фактах (общий гард — lib/number-honesty). */
export function briefNumbersHonest(brief: string, facts: string): boolean {
  return numbersHonest(brief, facts);
}

const STYLE_HINT: Record<string, string> = {
  friendly: 'дружелюбный друг: тепло, поддержка, лёгкая шутка',
  strict: 'строгий тренер: коротко, требовательно, без сюсюканья',
  calm: 'спокойный наставник: мягко, мудро, без давления',
  toxic: 'токсичный мотиватор: сарказм и подколки по делу, похвала очень скупо, без оскорблений личности',
};

/**
 * Текст пуша. baseBody — шаблон планировщика («3 задачи…, привычек 0/4. Начнём?»).
 * Возвращает пересказ мозга или честный шаблон (сбой/нет ключа/лишние числа).
 */
export async function composeMorningBrief(userId: string, baseBody: string, now: Date = new Date()): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, timezone: true, assistantStyle: true, assistantGender: true },
  });
  if (!user) return baseBody;
  const tz = user.timezone || 'UTC';
  const extras = await gatherBriefExtras(userId, tz, now).catch(() => [] as string[]);
  const base = baseBody.replace(/\s*Начнём\?\s*$/, '').replace(/\.\s*$/, '');
  const facts = [base, ...extras].filter(Boolean).join('; ');
  const fallback = `${[base, ...extras].join('; ')}. Начнём?`;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return fallback;
  const moodDown = await getEmotionalMemory()
    .detectMoodShift(userId)
    .then((m) => !!m?.shifted && m.direction === 'down')
    .catch(() => false);
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 220,
      system:
        `Ты — LifeOS, ассистент ${user.name}. Напиши утренний пуш: 2–3 коротких предложения, до 280 символов, по-русски, без markdown. ` +
        `Стиль: ${STYLE_HINT[user.assistantStyle] ?? STYLE_HINT.friendly}. Род речи ассистента: ${user.assistantGender === 'male' ? 'мужской' : 'женский'}. ` +
        (moodDown ? 'У пользователя спад настроения — мягче, без давления и сарказма. ' : '') +
        'Используй ТОЛЬКО факты ниже: не добавляй чисел, событий и выводов, которых нет. Выбери главное (срок долга, перегруз, бюджет — важнее счётчиков). ' +
        'Без приветствия (оно в заголовке). Закончи коротким вопросом-действием.',
      messages: [{ role: 'user', content: `Факты на сегодня: ${facts}` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text || text.length > 400 || !briefNumbersHonest(text, facts)) return fallback;
    return text;
  } catch (err) {
    console.warn('[morning-brief] compose failed:', err instanceof Error ? err.message : err);
    return fallback;
  }
}
