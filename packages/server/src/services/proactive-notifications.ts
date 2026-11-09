import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localDateOnlyUTC, localDaySlot, localHour, localDayOfWeek, localMonthRange } from '../lib/tz.js';
import { countOverduePending } from './task-overdue.js';
import { buildPersonMeetingBriefs } from './person-types/meeting-impl.js';
import { meetingPushBody } from './person-types/meeting.js';
import { delegationHints, delegationLine, durationMin, getHourRate, listTeam, LONG_MEETING_MIN, meetingCostLine } from './time-value.js';
import { calculateStreak } from './streak-service.js';
import { listDealStepsForDay } from './deals/service.js';
import { dealStepLabel, plural } from './deals/format.js';
import { carryBudgetLimits } from './budget-carry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProactiveNotification {
  title: string;
  body: string;
  type:
    | 'event_reminder_1h'
    | 'event_reminder_30m'
    | 'task_reminder_30m'
    | 'budget_alert'
    | 'habit_nudge'
    | 'weekly_summary'
    | 'morning_briefing'
    | 'evening_summary'
    | 'tomorrow_preview';
  scheduledFor: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Phase 7 P4 (E) — UTC instant полночи СЕГОДНЯ в tz юзера.
 * Раньше использовал server local date (now.getFullYear/Month/Date) —
 * для юзера в Almaty после 19:00 UTC server думал "завтра", DB query
 * `date: today` возвращал not юзерский день. Bug-class.
 */
function getToday(tz: string, at: Date = new Date()): Date {
  // FIX 2026-06-06: @db.Date task/event queries → UTC-полночь календарной даты.
  return localDateOnlyUTC(tz, at);
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
/**
 * Phase 7 P3 (2026-05-26) — TZ-aware. Раньше `setHours(hour)` =
 * server UTC, для юзера в Asia/Almaty слот 14:00 фактически =
 * 19:00 локально, а evening 21:00 = 02:00 ночи. `tz` обязателен.
 * Симметрия с timeToDate(time, tz) — без default'а на server local.
 */
export function daySlot(hour: number, tz: string, at: Date = new Date()): Date {
  return localDaySlot(hour, tz, at);
}

/**
 * Parse "HH:MM" → UTC-Date представляющий это время В ЛОКАЛЬНОЙ TZ
 * юзера сегодня. Фикс W11-класса (раньше брали серверный UTC как
 * локальный → wakeUpTime="07:00" интерпретировался как 07:00 UTC =
 * 12:00 Алматы; юзер видел «доброе утро» в полдень).
 *
 * tz ОБЯЗАТЕЛЕН (структурная защита от рецидива): TS-компилятор
 * сам поймает любой новый вызов без явной TZ. Legacy-fallback без
 * tz УБРАН специально — каждый caller обязан подумать о зоне юзера
 * (User.timezone). НЕТ tz → передавай "UTC" явно с обоснованием.
 */
export function timeToDate(time: string, tz: string, at: Date = new Date()): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const dayStart = localDayStartUTC(tz, at);
  return new Date(dayStart.getTime() + ((hours * 60 + minutes) * 60_000));
}

/** Days remaining in current month (including today) */
/** Phase 7 P4 (E) — Sunday в локальной tz юзера (раньше server day). */
function isSundayLocal(tz: string): boolean {
  return localDayOfWeek(tz) === 0;
}

// ---------------------------------------------------------------------------
// 1. Event reminders — 1 hour and 30 minutes before upcoming CalendarEvents
// ---------------------------------------------------------------------------
export async function generateEventReminders(
  userId: string,
  now: Date = new Date(),
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];

  // Phase 7 P4 (E): fetch tz first → today корректно по локальному дню.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone || 'UTC';
  const today = getToday(tz, now);

  // W11-фикс: event.startTime — HH:MM в локальной TZ юзера; чтобы
  // «за 1ч/30мин» считать корректно, конвертируем в UTC через tz.
  const events = await prisma.calendarEvent.findMany({
    where: { userId, date: today },
    select: { id: true, title: true, startTime: true },
  });

  // Джарвис-бриф (docs/plan/jarvis-roadmap.md №1): встреча с известным человеком —
  // за час не голое «подготовься», а что обещал ты/тебе, долги, сделка, что помню.
  const briefs =
    events.some((e) => e.startTime)
      ? await buildPersonMeetingBriefs(userId, now).catch(() => [])
      : [];

  for (const event of events) {
    if (!event.startTime) continue;

    const eventTime = timeToDate(event.startTime, tz, now);

    // 1 hour before
    const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);
    if (oneHourBefore > now) {
      const brief = briefs.find((b) => b.startTime === event.startTime && b.eventTitle === event.title);
      const briefBody = brief ? meetingPushBody(brief) : null;
      notifications.push({
        title: briefBody ? `Через час: ${event.title}` : 'Скоро встреча',
        body: briefBody ?? `Через час встреча: ${event.title}. Подготовься!`,
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
// 1b. Task reminders — 30 minutes before tasks with a time (P1 HOLLOW fix).
// task.time писался, но не читался — обещание «за 30 мин до задачи» было мёртвым.
// Дедуп/доставку наследует от scheduler (SentNotification + deliverNotification).
// ---------------------------------------------------------------------------
export async function generateTaskReminders(
  userId: string,
  now: Date = new Date(),
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone || 'UTC';
  const today = getToday(tz);

  const tasks = await prisma.task.findMany({
    where: { userId, date: today, completed: false, time: { not: null } },
    select: { title: true, time: true },
  });

  for (const task of tasks) {
    if (!task.time) continue;
    const taskTime = timeToDate(task.time, tz);
    const thirtyMinBefore = new Date(taskTime.getTime() - 30 * 60 * 1000);
    if (thirtyMinBefore > now) {
      notifications.push({
        title: 'Скоро задача',
        body: `Через 30 минут: ${task.title}`,
        type: 'task_reminder_30m',
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
  tz: string,
  name: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const now = new Date();
  // Месяц юзера, а не UTC сервера (1-го до 05:00 по Алматы был прошлый месяц).
  const { start: monthStart, end: monthEnd, month: currentMonth, year: currentYear, daysLeft } = localMonthRange(tz, now);

  await carryBudgetLimits(userId, currentMonth, currentYear);
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
    education: 'Образование',
    housing: 'Жильё',
    home: 'Жильё',
    other: 'Прочее',
  };

  for (const limit of budgetLimits) {
    const spent = spentByCategory[limit.category] ?? 0;
    const ratio = spent / limit.monthlyLimit;

    if (ratio >= 0.8) {
      const remaining = Math.max(0, Math.round(limit.monthlyLimit - spent));
      const label = CATEGORY_LABELS[limit.category] ?? limit.category;

      // C3 friend-tone: без обвинения "ты потратил", с конкретной
      // математикой (X/день) и actionable вопросом в конце.
      const dailyAvg = daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining;
      const tail =
        ratio >= 0.95
          ? 'Уже тонко \u2014 на следующей неделе надо урезать.'
          : `Не критично, но темп придётся снизить \u2014 где-то по ${dailyAvg}\u20B8/день. Что закажем урезать?`;
      notifications.push({
        title: 'Бюджет',
        body: `${name}, на ${label} осталось ${remaining}\u20B8 на ${daysLeft} ${daysLeft === 1 ? 'день' : 'дней'}. ${tail}`,
        type: 'budget_alert',
        scheduledFor: daySlot(10, tz), // #4: стабильный слот → 1/день локально
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
  tz: string,
  name: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];
  const now = new Date();
  // Phase 7 P4 (E) — gate по локальному часу юзера (раньше server local).
  const currentHour = localHour(tz, now);

  // Only nudge in the afternoon (14:00-20:00) ЛОКАЛЬНО
  if (currentHour < 14 || currentHour > 20) return notifications;

  const today = getToday(tz);

  const [habits, habitLogs, streak] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
    // Серия привычек (питомец удалён 2026-11-05).
    calculateStreak(userId, tz),
  ]);

  const completedIds = new Set(habitLogs.map((l) => l.habitId));
  const incomplete = habits.filter((h) => !completedIds.has(h.id));

  if (incomplete.length === 0) return notifications;

  const habitNames = incomplete.slice(0, 3).map((h) => h.name);
  const namesList = habitNames.join(', ');
  const suffix =
    incomplete.length > 3 ? ` и ещё ${incomplete.length - 3}` : '';

  // C3 friend-tone: имя + конкретная похвала за стрик впереди,
  // привычки как продолжение, "не дай упасть" вместо "не забудь".
  const head =
    streak > 0
      ? `${name}, ${streak} ${streak === 1 ? 'день' : 'дней'} подряд держишься \u2014 мощно.`
      : `${name}, день уходит.`;
  const closingHabit =
    streak > 0 ? 'Не дай стрику упасть.' : 'Закроем сегодня?';

  notifications.push({
    title: 'Привычки',
    body: `${head} Осталось: ${namesList}${suffix}. ${closingHabit}`,
    type: 'habit_nudge',
    scheduledFor: daySlot(14, tz), // #4: стабильный слот → 1/день локально
  });

  return notifications;
}

// ---------------------------------------------------------------------------
// 5. Weekly summary — Sunday evening recap
// ---------------------------------------------------------------------------
async function generateWeeklySummary(
  userId: string,
  tz: string,
  name: string,
): Promise<ProactiveNotification[]> {
  const notifications: ProactiveNotification[] = [];

  if (!isSundayLocal(tz)) return notifications;

  const now = new Date();
  const today = getToday(tz);

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

  // C3 friend-tone: концовка вопросом для engagement (друг
  // спрашивает что подкрутим, не штампует "так держать").
  if (overallPct >= 90) {
    motivationalText = 'Неделя огонь \u2014 так держать.';
  } else if (overallPct >= 70) {
    motivationalText = 'Хороший темп \u2014 не идеально, но стабильно. Что в следующей подкрутим?';
  } else if (overallPct >= 50) {
    motivationalText = 'Средне \u2014 можем больше. Что начнём с понедельника?';
  } else {
    motivationalText = 'Неделя была тяжёлая. Не сдавайся. Что главное на следующей?';
  }

  // Schedule for Sunday 20:00 ЛОКАЛЬНО (tz юзера), не server UTC
  const scheduledFor = daySlot(20, tz);

  // Only include if 20:00 hasn't passed yet, or it's within the current window
  // Phase 7 P4 (E) — локальный час, не server.
  if (scheduledFor > now || localHour(tz, now) === 20) {
    notifications.push({
      title: 'Итоги недели',
      body: `${name}, неделя: ${completedTasks} ${completedTasks === 1 ? 'задача' : 'задач'} закрыл, привычки ${habitsPct}%. ${motivationalText}`,
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
  const scheduledFor = timeToDate(user?.wakeUpTime || '07:00', user?.timezone || 'UTC');
  // Планировщик сам решит «пора/не пора» (scheduledFor<=now и <2ч
  // просрочки) и дедупнёт раз в день. Здесь просто собираем брифинг.
  return buildMorning(userId, user?.name ?? 'друг', scheduledFor, user?.timezone || 'UTC');
}

/** Длинный шаг по сделке не раздувает пуш: ~60 символов на шаг. */
const DEAL_STEP_PUSH_CHARS = 60;
const clip = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

export async function buildMorning(
  userId: string,
  name: string,
  scheduledFor: Date,
  tz: string,
): Promise<ProactiveNotification[]> {
  const today = getToday(tz);
  const [taskCount, events, habits, habitLogs, overdue, dealSteps] = await Promise.all([
    prisma.task.count({ where: { userId, date: today, completed: false, cancelled: false } }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      orderBy: { startTime: 'asc' },
      select: { title: true, startTime: true },
      take: 5,
    }),
    prisma.habit.count({ where: { userId, active: true } }),
    prisma.habitLog.count({ where: { userId, date: today, completed: true } }),
    countOverduePending(userId, today),
    // Шаги по сделкам на сегодня (нет шагов → части нет).
    listDealStepsForDay(userId, today),
  ]);

  const parts: string[] = [];
  parts.push(`${taskCount} ${taskCount === 1 ? 'задача' : 'задач'} на сегодня`);
  if (habits > 0) parts.push(`привычек ${habitLogs}/${habits}`);
  // Фикс C: невыполненные с прошлых дней не «пропадают» — честно показываем.
  if (overdue > 0) {
    parts.push(`⏳ ${overdue} ${overdue === 1 ? 'задача висит' : 'задач висят'} с прошлых дней`);
  }
  if (events.length > 0) {
    const first = events[0];
    parts.push(
      `${events.length} ${events.length === 1 ? 'встреча' : 'встречи'}` +
        (first.startTime ? ` (первая в ${first.startTime} — «${first.title}»)` : ''),
    );
  }
  if (dealSteps.length > 0) {
    const n = dealSteps.length;
    const more = n > 3 ? ` и ещё ${n - 3}` : '';
    parts.push(`${n} ${plural(n, ['шаг', 'шага', 'шагов'])} по сделкам: ${dealSteps.slice(0, 3).map((st) => clip(dealStepLabel(st), DEAL_STEP_PUSH_CHARS)).join('; ')}${more}`);
  }

  // C3 friend-tone: точка вместо "!" в title (спокойнее, не реклама),
  // CTA "Начнём?" вместо "Открой LifeOS — спланируем день" (без
  // призыва открывать app — friend, не маркетинг).
  return [
    {
      title: `Доброе утро, ${name}.`,
      body: `${parts.join(', ')}. Начнём?`,
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
  tz: string,
  name: string,
): Promise<ProactiveNotification[]> {
  const now = new Date();
  const today = getToday(tz);
  // Phase 7 P3 — 21:00 ЛОКАЛЬНО для юзера (раньше setHours = server UTC,
  // для Asia/Almaty юзера evening приходил в 02:00 ночи).
  const scheduledFor = daySlot(21, tz);

  // Только вечером (после 21:00). Утром/днём не собираем впустую.
  if (now < scheduledFor) return [];

  const [tasks, habits, habitLogs] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, cancelled: false },
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

  // C3 friend-tone: имя в начале, конкретные числа закрытых внутри
  // текста (не отдельной строкой "X/Y%"). Tone сохраняет 4 уровня.
  const closed = `${done} ${done === 1 ? 'задачу' : done < 5 ? 'задачи' : 'задач'} и ${habitLogs} ${habitLogs === 1 ? 'привычку' : habitLogs < 5 ? 'привычки' : 'привычек'}`;
  const tone =
    overall >= 90
      ? `${name}, мощный день — ${closed} закрыл. Ты в форме. Отдыхай.`
      : overall >= 60
        ? `${name}, хороший день — ${closed} закрыл. Завтра подхватим.`
        : overall >= 30
          ? `${name}, день был непростой — но ${closed} всё равно закрыл. Это уже движение. Завтра подхватим.`
          : `${name}, день тяжёлый. Закрыл ${closed} — это уже не ноль. Завтра чистый лист.`;

  return [
    {
      title: 'Итоги дня',
      body: tone,
      type: 'evening_summary',
      scheduledFor,
    },
  ];
}

// ---------------------------------------------------------------------------
// «Завтра» — заранее о встречах и графике (20:00 местного времени)
// ---------------------------------------------------------------------------
type PreviewEvent = { title: string; startTime: string | null };

function meetingsWord(n: number): string {
  const l2 = n % 100;
  const l1 = n % 10;
  if (l2 >= 11 && l2 <= 19) return 'встреч';
  if (l1 === 1) return 'встреча';
  if (l1 >= 2 && l1 <= 4) return 'встречи';
  return 'встреч';
}

function tasksWord(n: number): string {
  const l2 = n % 100;
  const l1 = n % 10;
  if (l2 >= 11 && l2 <= 19) return 'задач';
  if (l1 === 1) return 'задача';
  if (l1 >= 2 && l1 <= 4) return 'задачи';
  return 'задач';
}

/** Текст «на завтра»: встречи (первая — со временем) + число задач. null — пусто. */
export function tomorrowPreviewText(name: string, events: PreviewEvent[], taskCount: number): string | null {
  if (events.length === 0 && taskCount === 0) return null;
  const parts: string[] = [];
  if (events.length > 0) {
    const timed = events.filter((e) => e.startTime).sort((a, b) => (a.startTime! < b.startTime! ? -1 : 1));
    const first = timed[0] ?? events[0];
    const at = first.startTime ? ` первая в ${first.startTime} — «${first.title}»` : ` — «${first.title}»`;
    parts.push(`завтра ${events.length} ${meetingsWord(events.length)}:${at}`);
  }
  if (taskCount > 0) parts.push(`${events.length > 0 ? 'и ' : 'завтра '}${taskCount} ${tasksWord(taskCount)}`);
  const early = events.some((e) => e.startTime && e.startTime < '10:00');
  return `${name}, ${parts.join(' ')}.${early ? ' Начало раннее — ложись пораньше.' : ''}`;
}

/** Строки «время = деньги»: самая длинная встреча с ценой + до 2 «передать?». */
export async function timeValueLines(
  userId: string,
  events: Array<{ title: string; startTime: string | null; endTime?: string | null }>,
  taskTitles: string[],
  now: Date = new Date(),
): Promise<string[]> {
  const out: string[] = [];
  const longest = events
    .map((e) => ({ title: e.title, min: durationMin(e.startTime, e.endTime) }))
    .filter((e) => e.min !== null)
    .sort((a, b) => (b.min ?? 0) - (a.min ?? 0))[0];
  if (longest && (longest.min ?? 0) >= LONG_MEETING_MIN) {
    const line = meetingCostLine(longest.title, longest.min, await getHourRate(userId, now));
    if (line) out.push(line);
  }
  if (taskTitles.length > 0) {
    const team = await listTeam(userId);
    if (team.length > 0) out.push(...delegationHints(taskTitles, team).map(delegationLine));
  }
  return out;
}

/**
 * Предупредить заранее: в 20:00 по местному времени — что ждёт завтра.
 * Пусто завтра — ничего не шлём. Без 20:00 не собираем впустую.
 */
export async function generateTomorrowPreview(
  userId: string,
  tz: string,
  name: string,
  now: Date = new Date(),
): Promise<ProactiveNotification[]> {
  const scheduledFor = daySlot(20, tz, now);
  if (now < scheduledFor) return [];
  const tomorrow = new Date(getToday(tz, now).getTime() + 86_400_000);
  const [events, tasks] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { userId, date: tomorrow }, select: { title: true, startTime: true, endTime: true } }),
    prisma.task.findMany({ where: { userId, date: tomorrow, completed: false, cancelled: false }, select: { title: true }, take: 50 }),
  ]);
  const body = tomorrowPreviewText(name, events, tasks.length);
  if (!body) return [];
  // Время = деньги и команда (jarvis-roadmap №3): сколько стоит самая длинная
  // встреча и какие дела по части кого-то из команды. Нет цены часа / команды — без строк.
  const extra = await timeValueLines(userId, events, tasks.map((t) => t.title), now).catch(() => []);
  return [{ title: 'Завтра', body: [body, ...extra].join(' '), type: 'tomorrow_preview', scheduledFor }];
}

// ---------------------------------------------------------------------------
// Main: aggregate all proactive notifications for a user
// ---------------------------------------------------------------------------
export async function generateProactiveNotifications(
  userId: string,
): Promise<ProactiveNotification[]> {
  // Phase 7 P3 — fetch tz один раз, передаём вниз. Раньше generators
  // юзали server-local time (setHours) → для Алматы юзера evening
  // в 02:00 ночи. Morning уже был tz-aware (его не трогаем).
  // C3 (2026-05-26) — также fetches name для friend-tone текстов:
  // обращение по имени делает push'и человечнее (раньше только morning
  // знал имя, остальные говорили обезличенно).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, name: true, settings: true },
  });
  const tz = user?.timezone || 'UTC';
  const name = user?.name ?? 'друг';
  // Тумблеры Настроек (по умолчанию вкл): выключенное не шлём (аудит 2026-11-09).
  const prefs = (user?.settings ?? {}) as Record<string, unknown>;
  const morningOn = prefs.morningReminder !== false;
  const eveningOn = prefs.eveningReview !== false;
  const tasksOn = prefs.taskReminders !== false;

  const [
    eventReminders,
    taskReminders,
    budgetAlerts,
    habitNudges,
    weeklySummary,
    morningBriefing,
    eveningSummary,
    tomorrowPreview,
  ] = await Promise.all([
    generateEventReminders(userId),
    tasksOn ? generateTaskReminders(userId) : Promise.resolve([] as ProactiveNotification[]),
    generateBudgetAlerts(userId, tz, name),
    generateHabitNudges(userId, tz, name),
    // inactivityPing НЕ вызываем (Aydana fix d9b46f9) — функция
    // остаётся в коде для тестов/истории, но не пишет push.
    generateWeeklySummary(userId, tz, name),
    morningOn ? generateMorningBriefing(userId) : Promise.resolve([] as ProactiveNotification[]),
    eveningOn ? generateEveningSummary(userId, tz, name) : Promise.resolve([] as ProactiveNotification[]),
    eveningOn ? generateTomorrowPreview(userId, tz, name) : Promise.resolve([] as ProactiveNotification[]),
  ]);

  return [
    ...eventReminders,
    ...taskReminders,
    ...budgetAlerts,
    ...habitNudges,
    ...weeklySummary,
    ...morningBriefing,
    ...eveningSummary,
    ...tomorrowPreview,
  ].sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}
