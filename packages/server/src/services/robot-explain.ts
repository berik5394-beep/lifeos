import { prisma } from '../lib/prisma.js';
import { withLiveProgress } from './life-facts.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { withTimeout } from '../lib/with-timeout.js';
import { getUserTimezone } from '../lib/user-context.js';
import { numbersHonest } from '../lib/number-honesty.js';
import {
  addCivilDays,
  dateOnlyUTC,
  localDateOnlyUTC,
  localDateStr,
  localMonthOnlyUTC,
  localWeekStartUTC,
} from '../lib/tz.js';

/**
 * Робот-эпик, Часть 5: робот достаёт инструмент из мебели и объясняет, что
 * там важного. Пояснение пишет лёгкая модель, НО только по фактам, которые
 * мы сами собрали из БД (слой честности: ни одного выдуманного числа/имени).
 * Нет фактов → честное «пока пусто» без ИИ. Модель молчит/падает → ответ из
 * тех же фактов. В историю чата не пишется.
 */
export const EXPLAIN_PANELS = ['today', 'tasks', 'habits', 'goals', 'finance', 'calendar', 'journal', 'deals'] as const;
export type ExplainPanel = (typeof EXPLAIN_PANELS)[number];

export const PANEL_LABEL: Record<ExplainPanel, string> = {
  today: 'Сегодня',
  tasks: 'Задачи',
  habits: 'Привычки',
  goals: 'Цели',
  finance: 'Финансы',
  calendar: 'Календарь',
  journal: 'Дневник',
  deals: 'Сделки',
};

const EMPTY: Record<ExplainPanel, string> = {
  today: 'На сегодня пока пусто — ни задач, ни встреч. Самое время что-нибудь запланировать!',
  tasks: 'Задач пока нет. Скажи «создай задачу …» — и я запишу.',
  habits: 'Привычек пока нет. Давай заведём первую — например, стакан воды утром?',
  goals: 'Целей пока нет. Расскажи, чего хочешь добиться в этом году — разобьём на шаги.',
  finance: 'В этом месяце трат пока не записано. Скажи «потратил 2000 на обед» — и я учту.',
  calendar: 'В ближайшие дни встреч нет. Хочешь — запишу новую.',
  journal: 'Дневник пока пустой. Как ты сегодня — сон, энергия, настроение?',
  deals: 'Сделок пока нет. Скажи «Ахмет хочет оборудование на 2 млн» — заведу.',
};

const EXPLAIN_TIMEOUT_MS = 6000;
const CATEGORY_RU: Record<string, string> = {
  food: 'еда',
  transport: 'транспорт',
  entertainment: 'развлечения',
  clothing: 'одежда',
  health: 'здоровье',
  education: 'образование',
  housing: 'жильё',
  home: 'жильё',
  other: 'прочее',
};
const cat = (c: string) => CATEGORY_RU[c] ?? c;
const fmtMoney = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

/** Факты раздела — короткие строки, только из БД. Пусто → []. */
export async function gatherPanelFacts(
  userId: string,
  panel: ExplainPanel,
  now: Date = new Date(),
): Promise<string[]> {
  const tz = await getUserTimezone(userId);
  const today = localDateOnlyUTC(tz, now);
  const todayStr = localDateStr(tz, now);
  const facts: string[] = [];

  const taskFacts = async () => {
    const [todays, overdue] = await Promise.all([
      prisma.task.findMany({
        where: { userId, date: today, cancelled: false },
        orderBy: [{ time: 'asc' }, { createdAt: 'asc' }],
        select: { title: true, time: true, completed: true, priority: true },
        take: 20,
      }),
      prisma.task.count({ where: { userId, date: { lt: today }, completed: false, cancelled: false } }),
    ]);
    const open = todays.filter((t) => !t.completed);
    if (todays.length > 0) {
      facts.push(`Задач на сегодня: ${todays.length}, выполнено ${todays.length - open.length}.`);
      const next = open.slice(0, 3).map((t) => (t.time ? `${t.time} — ${t.title}` : t.title));
      if (next.length) facts.push(`Ещё не сделано: ${next.join('; ')}.`);
      const urgent = open.filter((t) => t.priority === 'critical' || t.priority === 'high').length;
      if (urgent) facts.push(`Срочных среди них: ${urgent}.`);
    }
    if (overdue > 0) facts.push(`Просрочено с прошлых дней: ${overdue}.`);
  };

  const eventFacts = async (days: number) => {
    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: { gte: today, lte: dateOnlyUTC(addCivilDays(todayStr, days - 1)) } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: { title: true, date: true, startTime: true },
      take: 10,
    });
    if (events.length) {
      const label = (d: Date) => {
        const s = d.toISOString().slice(0, 10);
        return s === todayStr ? 'сегодня' : s === addCivilDays(todayStr, 1) ? 'завтра' : s.slice(8, 10) + '.' + s.slice(5, 7);
      };
      facts.push(
        `Встречи (${events.length}): ` +
          events
            .slice(0, 4)
            .map((e) => `${label(e.date)}${e.startTime ? ' ' + e.startTime : ''} — ${e.title}`)
            .join('; ') +
          '.',
      );
    }
  };

  // Шаги по сделкам на ближайшие дни (флаг выкл. → [] → факта нет).
  const dealStepFacts = async (days: number) => {
    const { listDealSteps, describeDealStepsFact } = await import('./deals/index.js');
    const steps = await listDealSteps(userId, today, dateOnlyUTC(addCivilDays(todayStr, days)));
    const line = describeDealStepsFact(steps, todayStr);
    if (line) facts.push(line);
  };

  switch (panel) {
    case 'tasks':
      await taskFacts();
      break;
    case 'calendar':
      await eventFacts(3);
      await dealStepFacts(3);
      break;
    case 'today': {
      await taskFacts();
      await eventFacts(1);
      await dealStepFacts(1);
      const [habits, done] = await Promise.all([
        prisma.habit.count({ where: { userId, active: true } }),
        prisma.habitLog.count({ where: { userId, date: today, completed: true } }),
      ]);
      if (habits) facts.push(`Привычки сегодня: ${done} из ${habits}.`);
      break;
    }
    case 'habits': {
      const [habits, logs] = await Promise.all([
        prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true }, take: 30 }),
        prisma.habitLog.findMany({ where: { userId, date: today, completed: true }, select: { habitId: true } }),
      ]);
      if (habits.length) {
        const doneIds = new Set(logs.map((l) => l.habitId));
        const left = habits.filter((h) => !doneIds.has(h.id)).map((h) => h.name);
        facts.push(`Привычек: ${habits.length}, сегодня отмечено ${habits.length - left.length}.`);
        if (left.length) facts.push(`Осталось: ${left.slice(0, 5).join(', ')}.`);
      }
      break;
    }
    case 'goals': {
      const year = Number(todayStr.slice(0, 4));
      const [yearly, weekly] = await Promise.all([
        prisma.yearlyGoal
          .findMany({ where: { userId, year }, select: { goalText: true, area: true, progress: true, target: true, createdAt: true }, take: 10 })
          .then((gs) => withLiveProgress(userId, gs)),
        prisma.weeklyGoal.findMany({
          where: { userId, weekStart: localWeekStartUTC(tz, now), archivedAt: null },
          select: { goalText: true, completed: true },
          take: 10,
        }),
      ]);
      if (yearly.length) {
        facts.push(
          `Цели на ${year}: ` + yearly.slice(0, 4).map((g) => `${g.goalText} — ${Math.round(g.progress)}%`).join('; ') + '.',
        );
      }
      if (weekly.length) {
        facts.push(`Цели недели: ${weekly.filter((w) => w.completed).length} из ${weekly.length} выполнено.`);
      }
      break;
    }
    case 'finance': {
      const monthStart = localMonthOnlyUTC(tz, now);
      const [expenses, incomes, limits] = await Promise.all([
        prisma.expense.findMany({ where: { userId, date: { gte: monthStart } }, select: { amount: true, category: true } }),
        prisma.income.aggregate({ where: { userId, date: { gte: monthStart } }, _sum: { amount: true } }),
        prisma.budgetLimit.findMany({
          where: { userId, month: Number(todayStr.slice(5, 7)), year: Number(todayStr.slice(0, 4)) },
          select: { category: true, monthlyLimit: true },
        }),
      ]);
      if (expenses.length) {
        const total = expenses.reduce((s, e) => s + e.amount, 0);
        facts.push(`Потрачено в этом месяце: ${fmtMoney(total)}.`);
        const byCat = new Map<string, number>();
        expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
        const top = [...byCat].sort((a, b) => b[1] - a[1])[0];
        if (top) facts.push(`Больше всего — ${cat(top[0])}: ${fmtMoney(top[1])}.`);
        for (const l of limits) {
          const spent = byCat.get(l.category) ?? 0;
          if (spent > l.monthlyLimit * 0.8) {
            facts.push(`Лимит «${cat(l.category)}»: ${fmtMoney(spent)} из ${fmtMoney(l.monthlyLimit)}.`);
          }
        }
      }
      const inc = incomes._sum.amount ?? 0;
      if (inc > 0) facts.push(`Доход в этом месяце: ${fmtMoney(inc)}.`);
      break;
    }
    case 'deals': {
      const { gatherDealsSection } = await import('./deals/service.js');
      const s = await gatherDealsSection(userId, now);
      if (s) facts.push(s);
      break;
    }
    case 'journal': {
      const entries = await prisma.journalEntry.findMany({
        where: { userId, date: { gte: dateOnlyUTC(addCivilDays(todayStr, -6)) } },
        orderBy: { date: 'desc' },
        select: { date: true, mood: true, energy: true, sleepHours: true },
        take: 7,
      });
      if (entries.length) {
        facts.push(`Записей в дневнике за неделю: ${entries.length}.`);
        const last = entries[0];
        const parts = [
          last.mood != null ? `настроение ${last.mood}/10` : null,
          last.energy != null ? `энергия ${last.energy}/10` : null,
          last.sleepHours != null ? `сон ${last.sleepHours} ч` : null,
        ].filter(Boolean);
        if (parts.length) facts.push(`Последняя запись: ${parts.join(', ')}.`);
        if (last.date.toISOString().slice(0, 10) !== todayStr) facts.push('Сегодня записи ещё нет.');
      }
      break;
    }
  }
  return facts;
}

const STYLE_HINT: Record<string, string> = {
  friendly: 'дружелюбный: тепло, по-приятельски, можно мягко пошутить',
  strict: 'строгий тренер: коротко, требовательно, без сюсюканья',
  calm: 'спокойный наставник: мягко, без давления',
  toxic: 'токсичный мотиватор: сарказм и подколки, но без оскорблений',
};

/** Запасной ответ без ИИ: первые факты как есть. */
export function factsFallback(panel: ExplainPanel, facts: string[]): string {
  return facts.length ? facts.slice(0, 3).join(' ') : EMPTY[panel];
}

export interface Explanation {
  text: string;
  source: 'ai' | 'facts' | 'empty';
}

/** Пояснение робота к инструменту: ИИ по фактам → запасной ответ из фактов → «пусто». */
export async function explainPanel(
  userId: string,
  panel: ExplainPanel,
  now: Date = new Date(),
): Promise<Explanation> {
  const facts = await gatherPanelFacts(userId, panel, now).catch(() => [] as string[]);
  if (facts.length === 0) return { text: EMPTY[panel], source: 'empty' };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return { text: factsFallback(panel, facts), source: 'facts' };

  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { name: true, assistantStyle: true } })
    .catch(() => null);
  const style = STYLE_HINT[user?.assistantStyle ?? 'friendly'] ?? STYLE_HINT.friendly;
  const name = user?.name?.trim().split(/\s+/)[0] ?? '';

  const ask = async (): Promise<string | null> => {
    const resp = await createAnthropic(apiKey).messages.create({
      model: MODELS.haiku,
      max_tokens: 220,
      system:
        `Ты — LifeOS, робот-друг${name ? ` пользователя ${name}` : ''}. Ты только что достал инструмент «${PANEL_LABEL[panel]}» ` +
        `и показываешь его. Стиль: ${style}. Объясни в 1–3 коротких предложениях, что там важного и что предстоит, ` +
        `и при уместности — один конкретный следующий шаг. ` +
        `ИСПОЛЬЗУЙ ТОЛЬКО ФАКТЫ НИЖЕ: не выдумывай чисел, имён, времени, событий. ` +
        `Без markdown, без списков, по-русски.`,
      messages: [{ role: 'user', content: `Факты:\n${facts.map((f) => `- ${f}`).join('\n')}` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    return text || null;
  };

  const text = await withTimeout(ask().catch(() => null), EXPLAIN_TIMEOUT_MS, null);
  // Гард чисел: модель добавила число, которого нет в фактах → факты как есть.
  return text && numbersHonest(text, facts.join('\n'))
    ? { text, source: 'ai' }
    : { text: factsFallback(panel, facts), source: 'facts' };
}
