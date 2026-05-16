import { prisma } from '../lib/prisma.js';

/**
 * Proactive Insights — JARVIS сам смотрит на данные юзера и формирует
 * 3-7 коротких инсайтов: что бросается в глаза. Это то что в Iron Man
 * делает JARVIS: "сэр, у вас 5 непрочитанных, бюджет на завтрак на
 * исходе, и через час встреча — выехать стоит сейчас".
 *
 * Все правила — детерминированные (без AI), чтобы:
 *  1. Бесплатно (никаких Claude-вызовов на каждом утреннем брифинге).
 *  2. Предсказуемо (тестируемо).
 *  3. Быстро (один параллельный fan-out по БД).
 *
 * Каждый инсайт имеет:
 *  - id — стабильный код ("stale_task_3d", "budget_over_80") для UI/трекинга
 *  - severity — info / warning / critical (для цвета и порядка)
 *  - title — короткая фраза (что бросилось в глаза)
 *  - message — полное сообщение для UI/TTS
 *  - actionable — что юзер может сделать (опционально)
 *  - dismissKey — для "не показывать снова сегодня" (опц)
 */

export type Severity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  severity: Severity;
  category: 'tasks' | 'habits' | 'finance' | 'health' | 'events' | 'pet' | 'social';
  title: string;
  message: string;
  actionable?: { label: string; type: string; payload?: Record<string, unknown> };
  dismissKey?: string;
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};


/** Данные для правил — выбираются из БД, затем отдаются в чистое ядро. */
export interface InsightInput {
  staleTasks: Array<{ id: string; title: string; date: Date; priority: string }>;
  todayEvents: Array<{ title: string; startTime: string | null; location: string | null }>;
  todayHabitLogs: Array<{ habitId: string }>;
  activeHabits: Array<{ id: string; name: string }>;
  monthExpenses: Array<{ category: string; _sum: { amount: number | null } }>;
  budgetLimits: Array<{ category: string; monthlyLimit: number }>;
  pet:
    | { isAlive: boolean; health: number; streak: number; name: string; level: number }
    | null;
  upcomingEvents: Array<{ title: string; date: Date; startTime: string | null }>;
}

export async function generateInsights(userId: string): Promise<Insight[]> {
  const today = startOfDay(new Date());
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthStart = new Date(currentYear, currentMonth - 1, 1);
  const monthEnd = new Date(currentYear, currentMonth, 1);

  // Параллельно вытаскиваем всё что понадобится — экономим latency.
  const [
    staleTasks,
    todayEvents,
    todayHabitLogs,
    activeHabits,
    monthExpenses,
    budgetLimits,
    pet,
    upcomingEvents,
  ] = await Promise.all([
    // Задачи, которые откладываются 3+ дня (date < сегодня, не выполнены)
    prisma.task.findMany({
      where: {
        userId,
        completed: false,
        date: { lt: today },
      },
      orderBy: { date: 'asc' },
      take: 10,
      select: { id: true, title: true, date: true, priority: true },
    }),
    // Сегодняшние события
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      orderBy: { startTime: 'asc' },
      take: 20,
      select: { title: true, startTime: true, location: true },
    }),
    // Выполненные привычки за сегодня
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    // Расходы за месяц с суммой по категориям
    prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.findMany({
      where: { userId, month: currentMonth, year: currentYear },
    }),
    prisma.pet.findUnique({
      where: { userId },
      select: { isAlive: true, health: true, streak: true, lastFed: true, name: true, level: true },
    }),
    // Ближайшие события в следующие 24ч (для напоминаний)
    prisma.calendarEvent.findMany({
      where: {
        userId,
        date: { gte: today, lt: new Date(today.getTime() + 86_400_000 * 2) },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 10,
      select: { title: true, date: true, startTime: true },
    }),
  ]);

  return buildInsights(
    {
      staleTasks,
      todayEvents,
      todayHabitLogs,
      activeHabits,
      monthExpenses: monthExpenses.map((e) => ({
        category: e.category,
        _sum: { amount: e._sum.amount ?? null },
      })),
      budgetLimits: budgetLimits.map((b) => ({
        category: b.category,
        monthlyLimit: b.monthlyLimit,
      })),
      pet,
      upcomingEvents,
    },
    now,
  );
}

/**
 * Чистое ядро правил — без БД. Тестируется фикстурами (см.
 * proactive-insights.test.ts). `now` инъектируется для детерминизма:
 * event-soon и evening-lag зависят от текущего часа/времени.
 */
export function buildInsights(input: InsightInput, now: Date): Insight[] {
  const today = startOfDay(now);
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const {
    staleTasks,
    todayEvents,
    todayHabitLogs,
    activeHabits,
    monthExpenses,
    budgetLimits,
    pet,
    upcomingEvents,
  } = input;

  const insights: Insight[] = [];

  // ===== TASKS =====

  // Откладываемые задачи — критично если >= 3 дня
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const veryStale = staleTasks.filter((t) => t.date < twoDaysAgo);
  if (veryStale.length > 0) {
    const first = veryStale[0];
    const days = Math.floor((today.getTime() - first.date.getTime()) / 86_400_000);
    insights.push({
      id: `stale_task_${first.id}`,
      severity: veryStale.length >= 3 || days >= 5 ? 'warning' : 'info',
      category: 'tasks',
      title: 'Задачи зависли',
      message:
        veryStale.length === 1
          ? `«${first.title}» лежит ${days} дн. без движения. Может удалить или перенести?`
          : `${veryStale.length} задач лежат больше 3 дней. Самая старая — «${first.title}» (${days} дн). Разберём?`,
      actionable: {
        label: 'Разобрать зависшие',
        type: 'open_stale_tasks',
        payload: { ids: veryStale.map((t) => t.id) },
      },
      dismissKey: 'stale_tasks_today',
    });
  }

  // ===== HABITS =====

  if (activeHabits.length > 0) {
    const doneToday = todayHabitLogs.length;
    const total = activeHabits.length;
    const ratio = doneToday / total;
    const hour = now.getHours();

    // После 18:00 если меньше 30% сделано — мягкий пинок
    if (hour >= 18 && ratio < 0.3) {
      insights.push({
        id: 'habits_evening_lag',
        severity: 'info',
        category: 'habits',
        title: 'Привычки на сегодня',
        message: `Закрыто ${doneToday} из ${total} привычек. Вечер — успеешь поднажать?`,
        actionable: { label: 'Открыть привычки', type: 'open_habits' },
        dismissKey: 'habits_evening_lag',
      });
    } else if (ratio === 1 && total >= 3) {
      // 100% — похвалим
      insights.push({
        id: 'habits_all_done',
        severity: 'info',
        category: 'habits',
        title: 'Все привычки закрыты!',
        message: `${total} из ${total} — красавчик. Так держать.`,
      });
    }
  }

  // ===== FINANCE =====

  const spentByCategory = new Map(
    monthExpenses.map((e) => [e.category, Number(e._sum.amount ?? 0)]),
  );

  for (const limit of budgetLimits) {
    const spent = spentByCategory.get(limit.category) ?? 0;
    const ratio = limit.monthlyLimit > 0 ? spent / limit.monthlyLimit : 0;
    if (ratio >= 1) {
      insights.push({
        id: `budget_over_${limit.category}`,
        severity: 'critical',
        category: 'finance',
        title: `Бюджет «${limit.category}» превышен`,
        message: `Потрачено ${Math.round(spent)}₸ из ${Math.round(limit.monthlyLimit)}₸ (${Math.round(ratio * 100)}%). Остановись с этой категорией до конца месяца.`,
        actionable: { label: 'Финансы', type: 'open_finance', payload: { category: limit.category } },
        dismissKey: `budget_over_${limit.category}_${currentYear}_${currentMonth}`,
      });
    } else if (ratio >= 0.8) {
      insights.push({
        id: `budget_warn_${limit.category}`,
        severity: 'warning',
        category: 'finance',
        title: `«${limit.category}» — ${Math.round(ratio * 100)}% бюджета`,
        message: `Потрачено ${Math.round(spent)}₸ из ${Math.round(limit.monthlyLimit)}₸. Осталось ${Math.round(limit.monthlyLimit - spent)}₸ до конца месяца.`,
        actionable: { label: 'Финансы', type: 'open_finance', payload: { category: limit.category } },
        dismissKey: `budget_warn_${limit.category}_${currentYear}_${currentMonth}`,
      });
    }
  }

  // ===== EVENTS =====

  // Ближайшее событие в течение часа
  if (upcomingEvents.length > 0) {
    for (const e of upcomingEvents) {
      if (!e.startTime) continue;
      const [hh, mm] = e.startTime.split(':').map(Number);
      const eventTime = new Date(e.date);
      eventTime.setHours(hh || 0, mm || 0, 0, 0);
      const minsUntil = (eventTime.getTime() - now.getTime()) / 60_000;
      if (minsUntil > 0 && minsUntil <= 60) {
        insights.push({
          id: `event_soon_${eventTime.getTime()}`,
          severity: 'warning',
          category: 'events',
          title: 'Скоро событие',
          message: `«${e.title}» через ${Math.round(minsUntil)} мин. Уже выезжай если ехать.`,
          actionable: { label: 'Открыть календарь', type: 'open_events' },
        });
        break; // только ближайшее
      }
    }
  }

  // ===== PET =====

  if (pet && !pet.isAlive) {
    insights.push({
      id: 'pet_dead',
      severity: 'critical',
      category: 'pet',
      title: `${pet.name} не выдержал`,
      message: 'Питомец умер от долгого пропуска. Выполни 100% задач за день, чтобы оживить.',
      actionable: { label: 'Воскресить', type: 'revive_pet' },
    });
  } else if (pet && pet.health < 30) {
    insights.push({
      id: 'pet_sick',
      severity: 'warning',
      category: 'pet',
      title: `${pet.name} болеет`,
      message: `Здоровье ${Math.round(pet.health)}%. Закрой задачи и привычки сегодня — он восстановится.`,
      actionable: { label: 'Питомец', type: 'open_pet' },
    });
  } else if (pet && pet.streak >= 7) {
    insights.push({
      id: `pet_streak_${pet.streak}`,
      severity: 'info',
      category: 'pet',
      title: `${pet.streak} дней подряд!`,
      message: `Серия ${pet.streak} дней — не сорвись сегодня. ${pet.name} рассчитывает на тебя.`,
    });
  }

  // ===== EVENTS BRIEF (если есть события на сегодня) =====
  if (todayEvents.length > 0 && now.getHours() < 12) {
    const first = todayEvents[0];
    insights.push({
      id: 'today_events_brief',
      severity: 'info',
      category: 'events',
      title: `Сегодня ${todayEvents.length} ${todayEvents.length === 1 ? 'событие' : 'события'}`,
      message: `Первое — «${first.title}»${first.startTime ? ` в ${first.startTime}` : ''}${first.location ? `, ${first.location}` : ''}.`,
      actionable: { label: 'Открыть календарь', type: 'open_events' },
    });
  }

  // Сортируем: critical → warning → info; внутри severity — по category приоритету
  const severityRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  const categoryRank: Record<string, number> = {
    events: 0,
    finance: 1,
    pet: 2,
    tasks: 3,
    habits: 4,
    health: 5,
    social: 6,
  };
  insights.sort((a, b) => {
    const s = severityRank[a.severity] - severityRank[b.severity];
    if (s !== 0) return s;
    return (categoryRank[a.category] ?? 99) - (categoryRank[b.category] ?? 99);
  });

  return insights.slice(0, 7); // максимум 7 — не перегружаем UI
}
