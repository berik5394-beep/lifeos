import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProactiveNotification {
  title: string;
  body: string;
  type:
    | 'event_reminder_1h'
    | 'event_reminder_30m'
    | 'budget_alert'
    | 'habit_nudge'
    | 'inactivity_ping'
    | 'weekly_summary'
    | 'morning_briefing'
    | 'evening_summary';
  scheduledFor: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * #4-фикс: «фоновые пинки» (бюджет/привычки/бездействие) раньше
 * ставили scheduledFor=now → дедуп (userId,type,scheduledFor)
 * каждый 10-мин тик новый → один и тот же «питомец скучает»
 * улетал 16 раз. Стабильный СЛОТ на день (одно и то же значение
 * весь день) делает дедуп реальным: максимум 1 раз/день/тип.
 * Доставится первым тиком в окне [слот .. слот+2ч] (планировщик
 * сам режет просрочку >2ч), дальше — дедуп.
 */
export function daySlot(hour: number): Date {
  const d = getToday();
  d.setHours(hour, 0, 0, 0);
  return d;
}

function getMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

/**
 * Parse "HH:MM" → UTC-Date представляющий это время В ЛОКАЛЬНОЙ TZ
 * юзера сегодня. Это фикс W11-класса: раньше брали серверный UTC
 * как локальный (wakeUpTime=07:00 интерпретировалось как 07:00 UTC,
 * а должно — 07:00 Asia/Almaty = 02:00 UTC). Без tz получаешь
 * сдвиг = смещение зоны от UTC (5 часов для KZ → юзер видел
 * «доброе утро» в 12:00 локального).
 *
 * Если tz не передан — fallback на серверное (legacy-поведение).
 */
export function timeToDate(time: string, tz?: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  if (tz) {
    const dayStart = localDayStartUTC(tz);
    return new Date(dayStart.getTime() + ((hours * 60 + minutes) * 60_000));
  }
  const d = getToday();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Days remaining in current month (including today) */
function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

/** Check if today is Sunday (0 = Sunday) */
function isSunday(): boolean {
  return new Date().getDay() === 0;
}

// ---------------------------------------------------------------------------
// 1. Event reminders — 1 hour and 30 minutes before upcoming CalendarEvents
// ---------------------------------------------------------------------------
async function generateEventReminders(
  userId: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const today = getToday();
  const now = new Date();

  // W11-фикс: event.startTime — HH:MM в локальной TZ юзера; чтобы
  // «за 1ч/30мин» считать корректно, конвертируем в UTC через tz.
  const [user, events] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      select: { id: true, title: true, startTime: true },
    }),
  ]);
  const tz = user?.timezone || 'UTC';

  for (const event of events) {
    if (!event.startTime) continue;

    const eventTime = timeToDate(event.startTime, tz);

    // 1 hour before
    const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);
    if (oneHourBefore > now) {
      notifications.push({
        title: 'Скоро встреча',
        body: `Через час встреча: ${event.title}. Подготовься!`,
        type: 'event_reminder_1h',
        scheduledFor: oneHourBefore,
      });
    }

    // 30 minutes before
    const thirtyMinBefore = new Date(eventTime.getTime() - 30 * 60 * 1000);
    if (thirtyMinBefore > now) {
      notifications.push({
        title: 'Встреча скоро',
        body: `Через 30 минут: ${event.title}`,
        type: 'event_reminder_30m',
        scheduledFor: thirtyMinBefore,
      });
    }
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// 2. Budget alerts — when a category hits 80%+ of its monthly limit
// ---------------------------------------------------------------------------
async function generateBudgetAlerts(
  userId: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const now = new Date();
  const { start: monthStart, end: monthEnd } = getMonthRange();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const daysLeft = daysRemainingInMonth();

  const budgetLimits = await prisma.budgetLimit.findMany({
    where: { userId, month: currentMonth, year: currentYear },
    select: { category: true, monthlyLimit: true },
  });

  if (budgetLimits.length === 0) return notifications;

  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { category: true, amount: true },
  });

  // Sum expenses by category
  const spentByCategory: Record<string, number> = {};
  for (const expense of expenses) {
    spentByCategory[expense.category] =
      (spentByCategory[expense.category] ?? 0) + expense.amount;
  }

  const CATEGORY_LABELS: Record<string, string> = {
    food: 'Еда',
    transport: 'Транспорт',
    entertainment: 'Развлечения',
    clothing: 'Одежда',
    health: 'Здоровье',
    home: 'Дом',
    other: 'Прочее',
  };

  for (const limit of budgetLimits) {
    const spent = spentByCategory[limit.category] ?? 0;
    const ratio = spent / limit.monthlyLimit;

    if (ratio >= 0.8) {
      const remaining = Math.max(0, Math.round(limit.monthlyLimit - spent));
      const label = CATEGORY_LABELS[limit.category] ?? limit.category;

      notifications.push({
        title: 'Бюджет на пределе',
        body: `\u26A0\uFE0F Ты потратил ${Math.round(ratio * 100)}% бюджета на ${label}. Осталось ${remaining}\u20B8 на ${daysLeft} дней`,
        type: 'budget_alert',
        scheduledFor: daySlot(10), // #4: стабильный слот → 1/день
      });
    }
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// 3. Habit nudges — afternoon reminder if habits are incomplete
// ---------------------------------------------------------------------------
async function generateHabitNudges(
  userId: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const now = new Date();
  const currentHour = now.getHours();

  // Only nudge in the afternoon (14:00-20:00)
  if (currentHour < 14 || currentHour > 20) return notifications;

  const today = getToday();

  const [habits, habitLogs, pet] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
    prisma.pet.findFirst({
      where: { userId },
      select: { streak: true },
    }),
  ]);

  const completedIds = new Set(habitLogs.map((l) => l.habitId));
  const incomplete = habits.filter((h) => !completedIds.has(h.id));

  if (incomplete.length === 0) return notifications;

  const streak = pet?.streak ?? 0;
  const habitNames = incomplete.slice(0, 3).map((h) => h.name);
  const namesList = habitNames.join(', ');
  const suffix =
    incomplete.length > 3 ? ` и ещё ${incomplete.length - 3}` : '';

  const streakText =
    streak > 0 ? ` Стрик ${streak} дней \u2014 не потеряй!` : '';

  notifications.push({
    title: 'Не забудь о привычках',
    body: `Ты ещё не отметил: ${namesList}${suffix}.${streakText}`,
    type: 'habit_nudge',
    scheduledFor: daySlot(14), // #4: стабильный слот → 1/день
  });

  return notifications;
}

// ---------------------------------------------------------------------------
// 4. Inactivity ping — if user hasn't been active by noon
// ---------------------------------------------------------------------------
async function generateInactivityPing(
  userId: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const now = new Date();
  const currentHour = now.getHours();

  // Only check between 12:00 and 15:00
  if (currentHour < 12 || currentHour > 15) return notifications;

  const today = getToday();

  // Check if user has any activity today: habit logs, completed tasks, or expenses
  const [habitLogCount, completedTaskCount, expenseCount, pet] =
    await Promise.all([
      prisma.habitLog.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.task.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.expense.count({
        where: { userId, date: today },
      }),
      prisma.pet.findFirst({
        where: { userId },
        select: { name: true, type: true, isAlive: true },
      }),
    ]);

  const hasActivity = habitLogCount > 0 || completedTaskCount > 0 || expenseCount > 0;

  if (hasActivity) return notifications;

  const petName = pet?.name ?? 'Питомец';
  const petEmoji =
    pet?.type === 'cat'
      ? '\uD83D\uDC31'
      : pet?.type === 'dog'
        ? '\uD83D\uDC36'
        : pet?.type === 'fox'
          ? '\uD83E\uDD8A'
          : pet?.type === 'owl'
            ? '\uD83E\uDD89'
            : pet?.type === 'dragon'
              ? '\uD83D\uDC09'
              : '\uD83D\uDC3E';

  const body = pet?.isAlive === false
    ? `${petName} ждёт, когда ты вернёшься... Зайди и воскреси его!`
    : `Твой ${petName} скучает! Зайди и отметь привычки ${petEmoji}`;

  notifications.push({
    title: 'Мы скучаем!',
    body,
    type: 'inactivity_ping',
    scheduledFor: daySlot(12), // #4: стабильный слот → 1/день
  });

  return notifications;
}

// ---------------------------------------------------------------------------
// 5. Weekly summary — Sunday evening recap
// ---------------------------------------------------------------------------
async function generateWeeklySummary(
  userId: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];

  if (!isSunday()) return notifications;

  const now = new Date();
  const today = getToday();

  // Calculate week range (Monday-Sunday)
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6); // 6 days back from Sunday = Monday

  const [tasks, habits, habitLogs] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        date: { gte: weekStart, lte: today },
      },
      select: { completed: true },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true },
    }),
    prisma.habitLog.findMany({
      where: {
        userId,
        date: { gte: weekStart, lte: today },
        completed: true,
      },
      select: { habitId: true },
    }),
  ]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;

  // Habit completion rate: completed logs / (active habits * 7 days)
  const totalPossibleHabits = habits.length * 7;
  const habitsPct =
    totalPossibleHabits > 0
      ? Math.round((habitLogs.length / totalPossibleHabits) * 100)
      : 0;

  // Pick motivational text based on performance
  let motivationalText: string;
  const tasksPct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 100;
  const overallPct = (tasksPct + habitsPct) / 2;

  if (overallPct >= 90) {
    motivationalText = 'Невероятная неделя! Так держать!';
  } else if (overallPct >= 70) {
    motivationalText = 'Отличная работа! На следующей неделе будет ещё лучше.';
  } else if (overallPct >= 50) {
    motivationalText = 'Неплохо, но ты можешь больше. Новая неделя \u2014 новый шанс!';
  } else {
    motivationalText = 'Непростая неделя. Не сдавайся \u2014 каждый шаг считается!';
  }

  // Schedule for Sunday 20:00
  const scheduledFor = new Date(today);
  scheduledFor.setHours(20, 0, 0, 0);

  // Only include if 20:00 hasn't passed yet, or it's within the current window
  if (scheduledFor > now || now.getHours() === 20) {
    notifications.push({
      title: 'Итоги недели',
      body: `Итоги недели: ${completedTasks}/${totalTasks} задач, ${habitsPct}% привычек. ${motivationalText}`,
      type: 'weekly_summary',
      scheduledFor,
    });
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// 6. Morning briefing — в персональное wakeUpTime юзера (Фаза 4.2)
// ---------------------------------------------------------------------------
// Раньше брифинг был только эндпоинтом /briefing — приходил, лишь если
// юзер сам открыл приложение. Теперь планировщик САМ пушит его в
// wakeUpTime. Дедуп по (userId,'morning_briefing',scheduledFor) — один
// раз в день (scheduledFor = сегодня в wakeUpTime).
async function generateMorningBriefing(
  userId: string,
): Promise<ProactiveNotification[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, wakeUpTime: true, timezone: true },
  });
  // W11-фикс: wakeUpTime — локальное время юзера, НЕ серверный UTC.
  // Раньше «07:00» интерпретировалось как 07:00 UTC = 12:00 Алматы →
  // юзер видел «доброе утро» в полдень. Теперь tz-корректно.
  const scheduledFor = timeToDate(user?.wakeUpTime || '08:00', user?.timezone || 'UTC');
  // Планировщик сам решит «пора/не пора» (scheduledFor<=now и <2ч
  // просрочки) и дедупнёт раз в день. Здесь просто собираем брифинг.
  return buildMorning(userId, user?.name ?? 'друг', scheduledFor);
}

async function buildMorning(
  userId: string,
  name: string,
  scheduledFor: Date,
): Promise<ProactiveNotification[]> {
  const today = getToday();
  const [taskCount, events, habits, habitLogs] = await Promise.all([
    prisma.task.count({ where: { userId, date: today, completed: false } }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      orderBy: { startTime: 'asc' },
      select: { title: true, startTime: true },
      take: 5,
    }),
    prisma.habit.count({ where: { userId, active: true } }),
    prisma.habitLog.count({ where: { userId, date: today, completed: true } }),
  ]);

  const parts: string[] = [];
  parts.push(`${taskCount} ${taskCount === 1 ? 'задача' : 'задач'} на сегодня`);
  if (habits > 0) parts.push(`привычек ${habitLogs}/${habits}`);
  if (events.length > 0) {
    const first = events[0];
    parts.push(
      `${events.length} ${events.length === 1 ? 'встреча' : 'встречи'}` +
        (first.startTime ? ` (первая в ${first.startTime} — «${first.title}»)` : ''),
    );
  }

  return [
    {
      title: `Доброе утро, ${name}!`,
      body: `${parts.join(', ')}. Открой LifeOS — спланируем день.`,
      type: 'morning_briefing',
      scheduledFor,
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. Evening summary — итоги дня в 21:00 (Фаза 4.2)
// ---------------------------------------------------------------------------
// CLAUDE.md notif #4: "Вечер (21:00): список невыполненных + итоги дня".
// Дедуп по (userId,'evening_summary',scheduledFor) → один раз/день.
async function generateEveningSummary(
  userId: string,
): Promise<ProactiveNotification[]> {
  const now = new Date();
  const today = getToday();
  const scheduledFor = new Date(today);
  scheduledFor.setHours(21, 0, 0, 0);

  // Только вечером (после 21:00). Утром/днём не собираем впустую.
  if (now < scheduledFor) return [];

  const [tasks, habits, habitLogs] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today },
      select: { completed: true },
    }),
    prisma.habit.count({ where: { userId, active: true } }),
    prisma.habitLog.count({ where: { userId, date: today, completed: true } }),
  ]);

  const total = tasks.length;
  const done = tasks.filter((t) => t.completed).length;
  const tasksPct = total > 0 ? (done / total) * 100 : 100;
  const habitsPct = habits > 0 ? (habitLogs / habits) * 100 : 100;
  const overall = Math.round((tasksPct + habitsPct) / 2);

  const tone =
    overall >= 90
      ? 'Мощный день — ты герой. Отдыхай, заслужил.'
      : overall >= 60
        ? 'Хороший день. Завтра — ещё лучше.'
        : overall >= 30
          ? 'День был непростым, но ты двигался. Завтра новый шанс.'
          : 'Тяжёлый день. Главное — не бросил. Завтра чистый лист.';

  return [
    {
      title: 'Итоги дня',
      body: `Задачи ${done}/${total}, привычки ${habitLogs}/${habits} — ${overall}%. ${tone}`,
      type: 'evening_summary',
      scheduledFor,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main: aggregate all proactive notifications for a user
// ---------------------------------------------------------------------------
export async function generateProactiveNotifications(
  userId: string,
): Promise<ProactiveNotification[]> {
  const [
    eventReminders,
    budgetAlerts,
    habitNudges,
    inactivityPing,
    weeklySummary,
    morningBriefing,
    eveningSummary,
  ] = await Promise.all([
    generateEventReminders(userId),
    generateBudgetAlerts(userId),
    generateHabitNudges(userId),
    generateInactivityPing(userId),
    generateWeeklySummary(userId),
    generateMorningBriefing(userId),
    generateEveningSummary(userId),
  ]);

  return [
    ...eventReminders,
    ...budgetAlerts,
    ...habitNudges,
    ...inactivityPing,
    ...weeklySummary,
    ...morningBriefing,
    ...eveningSummary,
  ].sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}
