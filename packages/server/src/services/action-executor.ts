import { prisma } from '../lib/prisma.js';
import { searchFlights, buildRoute, getWeather, convertCurrency, searchHotels, sendTelegramMessage } from './external-apis.js';

export interface ActionResult {
  success: boolean;
  data?: unknown;
  message: string;
  clientAction?: string; // 'open_whatsapp', 'open_maps', etc — client handles these
  clientData?: Record<string, unknown>;
}

export async function executeAction(
  actionName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<ActionResult> {
  try {
    switch (actionName) {

      // ═══ ЗАДАЧИ ═══
      case 'create_task': {
        const task = await prisma.task.create({
          data: {
            userId,
            title: String(input.title),
            date: new Date(String(input.date)),
            time: input.time ? String(input.time) : null,
            category: String(input.category || 'personal'),
            priority: String(input.priority || 'medium'),
          },
        });
        return { success: true, data: task, message: `Задача "${input.title}" создана на ${input.date}${input.time ? ' в ' + String(input.time) : ''}` };
      }

      case 'complete_task': {
        const taskId = String(input.taskId || '');
        // Try by ID first, then by title
        let task = taskId ? await prisma.task.findFirst({ where: { id: taskId, userId } }) : null;
        if (!task && input.title) {
          task = await prisma.task.findFirst({
            where: { userId, title: { contains: String(input.title), mode: 'insensitive' }, completed: false },
          });
        }
        if (!task) return { success: false, message: 'Задача не найдена' };
        await prisma.task.update({ where: { id: task.id }, data: { completed: true } });
        return { success: true, data: task, message: `Задача "${task.title}" выполнена ✅` };
      }

      case 'delete_task': {
        const taskId = String(input.taskId || '');
        const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
        if (!task) return { success: false, message: 'Задача не найдена' };
        await prisma.task.delete({ where: { id: task.id } });
        return { success: true, message: `Задача "${task.title}" удалена` };
      }

      // ═══ ПРИВЫЧКИ ═══
      case 'complete_habit': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        let habit = input.habitId
          ? await prisma.habit.findFirst({ where: { id: String(input.habitId), userId } })
          : null;
        if (!habit && input.name) {
          habit = await prisma.habit.findFirst({
            where: { userId, name: { contains: String(input.name), mode: 'insensitive' }, active: true },
          });
        }
        if (!habit) return { success: false, message: 'Привычка не найдена' };
        await prisma.habitLog.upsert({
          where: { habitId_date: { habitId: habit.id, date: today } },
          update: { completed: true },
          create: { habitId: habit.id, userId, date: today, completed: true },
        });
        return { success: true, message: `Привычка "${habit.name}" отмечена ✅` };
      }

      case 'complete_multiple_habits': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const ids = (input.habitIds as string[]) || [];
        let count = 0;
        for (const habitId of ids) {
          try {
            await prisma.habitLog.upsert({
              where: { habitId_date: { habitId, date: today } },
              update: { completed: true },
              create: { habitId, userId, date: today, completed: true },
            });
            count++;
          } catch { /* skip invalid */ }
        }
        return { success: true, message: `Отмечено привычек: ${count} ✅` };
      }

      // ═══ СОБЫТИЯ / КАЛЕНДАРЬ ═══
      case 'create_event': {
        const event = await prisma.calendarEvent.create({
          data: {
            userId,
            title: String(input.title),
            date: new Date(String(input.date)),
            startTime: input.startTime ? String(input.startTime) : null,
            endTime: input.endTime ? String(input.endTime) : null,
            location: input.location ? String(input.location) : null,
            description: input.description ? String(input.description) : null,
            source: 'voice',
          },
        });
        return { success: true, data: event, message: `Встреча "${input.title}" создана на ${input.date}${input.startTime ? ' в ' + String(input.startTime) : ''}` };
      }

      case 'get_free_slots': {
        const dateFrom = new Date(String(input.dateFrom));
        const dateTo = new Date(String(input.dateTo));
        const minDuration = Number(input.minDurationMinutes) || 60;
        const events = await prisma.calendarEvent.findMany({
          where: { userId, date: { gte: dateFrom, lte: dateTo } },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        });
        const slots = findFreeSlots(events, dateFrom, dateTo, minDuration);
        return { success: true, data: slots, message: `Найдено ${slots.length} свободных окон` };
      }

      // ═══ ФИНАНСЫ ═══
      case 'add_expense': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const expense = await prisma.expense.create({
          data: {
            userId, date: today,
            amount: Number(input.amount),
            category: String(input.category || 'other'),
            description: String(input.description || ''),
          },
        });
        const analysis = await analyzeBudgetAfterExpense(userId, String(input.category || 'other'));
        return {
          success: true,
          data: { expense, analysis },
          message: `Расход ${input.amount} ₸ записан${input.description ? ' (' + String(input.description) + ')' : ''}. ${analysis.warning || ''}`,
        };
      }

      case 'add_income': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const income = await prisma.income.create({
          data: { userId, date: today, amount: Number(input.amount), source: String(input.source || '') },
        });
        return { success: true, data: income, message: `Доход ${input.amount} ₸ записан${input.source ? ' (' + String(input.source) + ')' : ''}` };
      }

      case 'get_budget_analysis': {
        const analysis = await getFullBudgetAnalysis(userId);
        return { success: true, data: analysis, message: 'Анализ бюджета готов' };
      }

      // ═══ КОНТАКТЫ ═══
      case 'search_contacts': {
        const contacts = await prisma.contactCache.findMany({
          where: { userId, name: { contains: String(input.query), mode: 'insensitive' } },
          take: 5,
        });
        if (contacts.length === 0) {
          return { success: false, message: `Контакт "${input.query}" не найден. Попробуйте синхронизировать контакты в настройках.` };
        }
        return {
          success: true,
          data: contacts.map(c => ({ name: c.name, phone: c.phone, email: c.email })),
          message: `Найдено ${contacts.length}: ${contacts.map(c => c.name).join(', ')}`,
        };
      }

      // ═══ ПУТЕШЕСТВИЯ ═══
      case 'search_flights': {
        const flights = await searchFlights({
          from: String(input.from), to: String(input.to),
          departDate: String(input.departDate),
          returnDate: input.returnDate ? String(input.returnDate) : undefined,
        });
        {
          const mock = flights.some((f) => f.isMock);
          return {
            success: true,
            data: flights,
            message: mock
              ? `Ориентировочно ${flights.length} вариантов (точные цены покажу когда подключим API перелётов — пока примерные)`
              : `Найдено ${flights.length} вариантов перелёта`,
          };
        }
      }

      case 'search_hotels': {
        const hotels = await searchHotels({
          city: String(input.city),
          checkIn: String(input.checkIn), checkOut: String(input.checkOut),
          maxPrice: input.maxPrice ? Number(input.maxPrice) : undefined,
        });
        return {
          success: true,
          data: hotels.hotels,
          message: hotels.isMock
            ? `Ориентир по ценам на отели в ${input.city} (точные варианты — по ссылке): ${hotels.link}`
            : `Найдено ${hotels.hotels.length} отелей. ${hotels.link}`,
        };
      }

      case 'build_route': {
        const route = await buildRoute({
          from: String(input.from), to: String(input.to),
          mode: input.mode ? String(input.mode) : undefined,
        });
        return {
          success: true, data: route,
          message: route.isMock
            ? `Маршрут примерно ${route.distance}, ~${route.duration} (точное время — по ссылке в картах)`
            : `Маршрут: ${route.distance}, время в пути ${route.duration}`,
          clientAction: 'open_maps',
          clientData: { destination: String(input.to), mode: String(input.mode || 'driving') },
        };
      }

      case 'create_travel_plan': {
        const dateFrom = new Date(String(input.dateFrom));
        const taskDate = new Date(dateFrom); taskDate.setDate(taskDate.getDate() - 3);
        const tasks = [
          { title: `Купить билеты в ${input.destination}`, priority: 'high' },
          { title: 'Забронировать отель', priority: 'high' },
          { title: 'Собрать чемодан', priority: 'medium' },
          { title: 'Проверить документы (паспорт, виза)', priority: 'critical' },
        ];
        for (const t of tasks) {
          await prisma.task.create({
            data: { userId, title: t.title, date: taskDate, category: 'personal', priority: t.priority },
          });
        }
        await prisma.calendarEvent.create({
          data: { userId, title: `Поездка в ${input.destination}`, date: dateFrom, description: String(input.purpose || 'Путешествие'), source: 'voice' },
        });
        const plan = await prisma.travelPlan.create({
          data: {
            userId, destination: String(input.destination), dateFrom,
            dateTo: input.dateTo ? new Date(String(input.dateTo)) : null,
            purpose: input.purpose ? String(input.purpose) : null,
            budget: input.budget ? Number(input.budget) : null,
          },
        });
        return { success: true, data: plan, message: `План путешествия в ${input.destination} создан: ${tasks.length} задач + событие в календаре` };
      }

      // ═══ УТИЛИТЫ ═══
      case 'set_alarm': {
        return {
          success: true,
          data: { time: input.time, date: input.date, label: input.label },
          message: `Напоминание "${input.label}" установлено на ${input.time}`,
          clientAction: 'set_alarm',
          clientData: { time: String(input.time), date: String(input.date || ''), label: String(input.label) },
        };
      }

      case 'send_telegram': {
        // Phase 3.6: реальная исходящая отправка себе в Telegram.
        // Идёт ТОЛЬКО через подтверждение (Phase 1.2) — оркестратор
        // не исполняет это без явного «да» (исходящий side-effect).
        const text = String(input.text || '').trim();
        if (!text) return { success: false, message: 'Нечего отправлять — пустой текст.' };
        const res = await sendTelegramMessage(userId, text);
        return { success: true, message: res };
      }

      case 'send_message': {
        const via = String(input.via || 'whatsapp');
        return {
          success: true,
          data: { contact: input.contact, text: input.text, via },
          message: `Открываю ${via === 'whatsapp' ? 'WhatsApp' : via === 'telegram' ? 'Telegram' : 'SMS'} с сообщением для ${input.contact}`,
          clientAction: `open_${via}`,
          clientData: { contact: String(input.contact), text: String(input.text), via },
        };
      }

      case 'get_weather': {
        const weather = await getWeather(String(input.city));
        return { success: true, data: weather, message: `Погода в ${input.city}: ${weather.temp}°C, ${weather.description}` };
      }

      case 'convert_currency': {
        const result = await convertCurrency(Number(input.amount), String(input.from), String(input.to));
        return { success: true, data: result, message: `${input.amount} ${input.from} = ${result.converted} ${input.to}` };
      }

      case 'journal_entry': {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const entry = await prisma.journalEntry.upsert({
          where: { userId_date: { userId, date: today } },
          update: {
            ...(input.sleepHours !== undefined && { sleepHours: Number(input.sleepHours) }),
            ...(input.energy !== undefined && { energy: Number(input.energy) }),
            ...(input.mood !== undefined && { mood: Number(input.mood) }),
            ...(input.notes !== undefined && { notes: String(input.notes) }),
          },
          create: {
            userId, date: today,
            sleepHours: input.sleepHours ? Number(input.sleepHours) : null,
            energy: input.energy ? Number(input.energy) : null,
            mood: input.mood ? Number(input.mood) : null,
            notes: input.notes ? String(input.notes) : null,
          },
        });
        return { success: true, data: entry, message: 'Дневник обновлён' };
      }

      case 'goodnight_summary': {
        const summary = await buildGoodnightSummary(userId);
        return { success: true, data: summary, message: summary.text };
      }

      default:
        return { success: false, message: `Неизвестное действие: ${actionName}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Ошибка: ${msg}` };
  }
}

// ═══ HELPER FUNCTIONS ═══

function findFreeSlots(
  events: Array<{ date: Date; startTime: string | null; endTime: string | null }>,
  dateFrom: Date, dateTo: Date, minDurationMinutes: number,
): Array<{ date: string; from: string; to: string; durationMinutes: number }> {
  const slots: Array<{ date: string; from: string; to: string; durationMinutes: number }> = [];
  const WORK_START = '09:00';
  const WORK_END = '20:00';

  for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayEvents = events
      .filter(e => e.date.toISOString().split('T')[0] === dateStr && e.startTime && e.endTime)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    let currentStart = WORK_START;
    for (const event of dayEvents) {
      if (event.startTime && event.startTime > currentStart) {
        const duration = timeDiff(currentStart, event.startTime);
        if (duration >= minDurationMinutes) {
          slots.push({ date: dateStr, from: currentStart, to: event.startTime, durationMinutes: duration });
        }
      }
      if (event.endTime && event.endTime > currentStart) currentStart = event.endTime;
    }
    if (currentStart < WORK_END) {
      const duration = timeDiff(currentStart, WORK_END);
      if (duration >= minDurationMinutes) {
        slots.push({ date: dateStr, from: currentStart, to: WORK_END, durationMinutes: duration });
      }
    }
  }
  return slots;
}

function timeDiff(from: string, to: string): number {
  const [h1, m1] = from.split(':').map(Number);
  const [h2, m2] = to.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

async function analyzeBudgetAfterExpense(userId: string, category: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [expenses, limit] = await Promise.all([
    prisma.expense.aggregate({
      where: { userId, category, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.findUnique({
      where: { userId_category_month_year: { userId, category, month: now.getMonth() + 1, year: now.getFullYear() } },
    }),
  ]);

  const spent = expenses._sum.amount ?? 0;
  const budgetLimit = limit?.monthlyLimit ?? 0;
  const percentage = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
  const daysLeft = monthEnd.getDate() - now.getDate();

  let warning = '';
  if (budgetLimit > 0) {
    if (percentage > 100) warning = `⚠️ Бюджет на ${category} превышен на ${Math.round(percentage - 100)}%!`;
    else if (percentage > 80) warning = `⚡ Осторожно: ${Math.round(percentage)}% бюджета на ${category} использовано.`;
  }

  return { spent, budgetLimit, percentage, daysLeft, warning, dailyRemaining: daysLeft > 0 ? Math.round((budgetLimit - spent) / daysLeft) : 0 };
}

async function getFullBudgetAnalysis(userId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [expenses, incomes, limits] = await Promise.all([
    prisma.expense.findMany({ where: { userId, date: { gte: monthStart, lte: monthEnd } } }),
    prisma.income.aggregate({ where: { userId, date: { gte: monthStart, lte: monthEnd } }, _sum: { amount: true } }),
    prisma.budgetLimit.findMany({ where: { userId, month: now.getMonth() + 1, year: now.getFullYear() } }),
  ]);

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = incomes._sum.amount ?? 0;
  const byCategory: Record<string, number> = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
  const daysLeft = monthEnd.getDate() - now.getDate();
  const dailyBudget = daysLeft > 0 ? Math.round((totalIncome - totalSpent) / daysLeft) : 0;

  return { totalSpent, totalIncome, byCategory, limits: limits.map(l => ({ category: l.category, limit: l.monthlyLimit })), daysLeft, dailyBudget };
}

async function buildGoodnightSummary(userId: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [tasks, habits, habitLogs, expenses] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: today } }),
    prisma.habit.findMany({ where: { userId, active: true } }),
    prisma.habitLog.findMany({ where: { userId, date: today, completed: true } }),
    prisma.expense.aggregate({ where: { userId, date: today }, _sum: { amount: true } }),
  ]);

  const tasksCompleted = tasks.filter(t => t.completed).length;
  const habitsCompleted = habitLogs.length;
  const totalProgress = Math.round(
    ((tasksCompleted / Math.max(tasks.length, 1)) * 50 + (habitsCompleted / Math.max(habits.length, 1)) * 50)
  );
  const todaySpent = expenses._sum.amount ?? 0;

  return {
    tasksCompleted, tasksTotal: tasks.length,
    habitsCompleted, habitsTotal: habits.length,
    totalProgress, todaySpent,
    text: `Итоги дня: задачи ${tasksCompleted}/${tasks.length}, привычки ${habitsCompleted}/${habits.length}, прогресс ${totalProgress}%. Потрачено: ${todaySpent} ₸.`,
  };
}
