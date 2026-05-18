import { prisma } from '../lib/prisma.js';
import { executeAction } from './action-executor.js';
import { runRegistryTool } from '../tools/index.js';
import { triageInbox } from './gmail.js';
import { getRelevantMemories } from './memory-service.js';
import { getWeather } from './external-apis.js';

/**
 * Phase 1.4 — локальные инструменты для агентного цикла JARVIS.
 *
 * Раньше runAgent делал один проход с web_search → «организуй поездку»
 * не превращалось в цепочку (посмотреть календарь → создать задачи →
 * поставить событие). Теперь Claude получает эти инструменты и сам
 * решает порядок вызовов; claude-agent крутит tool-use цикл.
 *
 * Принцип безопасности: в автономном цикле — только ЧТЕНИЕ и ОБРАТИМЫЕ
 * записи (задачи/события/привычки). Деньги (add_expense/add_income)
 * сюда НЕ входят — они идут через подтверждение (Phase 1.2), модель
 * не должна тратить за юзера без явного «да».
 */

// Anthropic tool schema (SDK 0.39 типы кастомных инструментов знает).
export const LOCAL_TOOLS = [
  {
    // @deprecated 9A.1 — реализация в tools/get-tasks.ts (реестр).
    // Схема тут оставлена до 9A.8 (свич claude-agent на anthropicSchemas).
    name: 'get_tasks',
    description:
      'Список задач юзера на дату или диапазон. Используй чтобы понять загрузку дня перед планированием.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (по умолчанию сегодня)' },
        includeCompleted: { type: 'boolean' },
      },
    },
  },
  {
    // @deprecated 9A.2 — реализация в tools/get-calendar.ts (реестр).
    // Схема тут до 9A.8 (свич claude-agent на anthropicSchemas).
    name: 'get_calendar',
    description: 'События календаря юзера в диапазоне дат. Для проверки занятости/конфликтов.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_budget',
    description: 'Сводка бюджета за текущий месяц: потрачено, доход, по категориям, лимиты.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_task',
    description: 'Создать задачу. Обратимо — можно вызывать в плане без подтверждения.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM (опц.)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        category: { type: 'string' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'create_event',
    description: 'Создать событие/встречу в календаре. Обратимо.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        startTime: { type: 'string', description: 'HH:MM (опц.)' },
        endTime: { type: 'string', description: 'HH:MM (опц.)' },
        location: { type: 'string' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'complete_habit',
    description: 'Отметить привычку выполненной по имени. Обратимо.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    // @deprecated 9A.3 — реализация в tools/get-email-triage.ts.
    // Схема тут до 9A.8 (свич claude-agent на anthropicSchemas).
    name: 'get_email_triage',
    description:
      'Разобрать непрочитанные письма Gmail: что важное, что можно проигнорировать. Read-only. Вызывай на «разбери почту», «что в почте», «есть важные письма».',
    input_schema: { type: 'object', properties: {} },
  },
  {
    // @deprecated 9A.4 — реализация в tools/recall-person.ts.
    // Схема тут до 9A.8 (свич claude-agent на anthropicSchemas).
    name: 'recall_person',
    description:
      'Вспомнить человека: контакт (телефон/email/др.) + что юзер про него говорил (память). Read-only. Вызывай на «кто такой X», «телефон X», «напомни про X», «что я говорил про X».',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'имя человека' } },
      required: ['name'],
    },
  },
  {
    name: 'get_weekly_plan',
    description:
      'Цели/план на ТЕКУЩУЮ неделю (WeeklyGoal): что выполнено, что осталось. Вызывай на «какие планы на неделю», «что у меня по неделе», «недельные цели».',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_trip',
    description:
      'Активные/ближайшие поездки юзера (TravelPlan): куда, даты вылета/возврата, статус, ссылка брони. ОБЯЗАТЕЛЬНО вызывай на «когда у меня вылет», «куда я лечу», «что с поездкой», «бронь» — не отвечай «нет данных» не проверив.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_weather',
    description:
      'Погода и прогноз в городе (по умолчанию Алматы). Вызывай на «какая погода», «что надеть», «во сколько выезжать» — особенно если у юзера сегодня встреча/поездка.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'город (опц., по умолчанию Алматы)' },
      },
    },
  },
  {
    name: 'get_goal_progress',
    description:
      'Прогресс по годовым целям: реальный % vs темп года + связанные задачи + что юзер сам говорил про эту цель (память). Вызывай на «как я иду к цели», «что с финансовой целью», «отстаю ли я по здоровью».',
    input_schema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          description: 'finance | health | career | spirituality (опц., иначе все)',
        },
      },
    },
  },
] as const;

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Выполняет локальный инструмент. Возвращает строку-результат для модели. */
export async function runLocalTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'get_tasks': {
        // 9A.1: мигрировано в реестр (tools/get-tasks.ts). Делегируем
        // туда (zod+аудит). Свич схем claude-agent на SSOT — 9A.8.
        console.warn(
          `[deprecated 9A] runLocalTool.get_tasks → registry (user=${userId})`,
        );
        const r = await runRegistryTool('get_tasks', input, { userId });
        return JSON.stringify(r);
      }
      case 'get_calendar': {
        // 9A.2: мигрировано в реестр (tools/get-calendar.ts). Свич
        // схем claude-agent на SSOT — 9A.8.
        console.warn(
          `[deprecated 9A] runLocalTool.get_calendar → registry (user=${userId})`,
        );
        const r = await runRegistryTool('get_calendar', input, { userId });
        return JSON.stringify(r);
      }
      case 'get_budget': {
        const r = await executeAction('get_budget_analysis', {}, userId);
        return JSON.stringify(r.data ?? r.message);
      }
      // SSOT Шаг 5: write-tools агентного цикла → реестр (zod+аудит),
      // не legacy executeAction (иначе сыпется deprecated-warning).
      case 'create_task': {
        const r = (await runRegistryTool('create_task', input, { userId })) as {
          message?: string;
        };
        return r.message ?? 'Готово.';
      }
      case 'create_event': {
        const r = (await runRegistryTool('create_event', input, { userId })) as {
          message?: string;
        };
        return r.message ?? 'Готово.';
      }
      case 'complete_habit': {
        const r = (await runRegistryTool(
          'complete_habit',
          { name: input.name },
          { userId },
        )) as { message?: string };
        return r.message ?? 'Готово.';
      }
      case 'get_email_triage': {
        // 9A.3: мигрировано в реестр (tools/get-email-triage.ts).
        // Свич схем claude-agent на SSOT — 9A.8.
        console.warn(
          `[deprecated 9A] runLocalTool.get_email_triage → registry (user=${userId})`,
        );
        const r = await runRegistryTool('get_email_triage', input, { userId });
        return JSON.stringify(r);
      }
      case 'recall_person': {
        // 9A.4: мигрировано в реестр (tools/recall-person.ts).
        // Свич схем claude-agent на SSOT — 9A.8.
        console.warn(
          `[deprecated 9A] runLocalTool.recall_person → registry (user=${userId})`,
        );
        const r = await runRegistryTool('recall_person', input, { userId });
        return JSON.stringify(r);
      }
      case 'get_weekly_plan': {
        const m = startOfDay(new Date());
        m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // понедельник
        const wg = await prisma.weeklyGoal.findMany({
          where: { userId, weekStart: m },
          select: { goalText: true, completed: true },
          orderBy: { order: 'asc' },
          take: 12,
        });
        return JSON.stringify({
          weekStart: m.toISOString().slice(0, 10),
          done: wg.filter((g) => g.completed).length,
          total: wg.length,
          goals: wg.map((g) => ({ text: g.goalText, done: g.completed })),
        });
      }
      case 'get_trip': {
        // #1: «запомнил поездку», но «когда вылет» → «нет данных».
        // Корень: поездка в TravelPlan, а мозг туда не смотрел.
        const today = startOfDay(new Date());
        const horizon = new Date(today.getTime() - 86_400_000); // вчера, чтобы свежие тоже
        const trips = await prisma.travelPlan.findMany({
          where: {
            userId,
            status: { in: ['planning', 'booked', 'in_progress'] },
            dateFrom: { gte: horizon },
          },
          orderBy: { dateFrom: 'asc' },
          take: 3,
          select: {
            destination: true,
            dateFrom: true,
            dateTo: true,
            status: true,
            routes: true,
          },
        });
        if (trips.length === 0) {
          return JSON.stringify({ trips: [], note: 'Активных поездок в плане нет.' });
        }
        return JSON.stringify({
          trips: trips.map((t) => ({
            destination: t.destination,
            departure: t.dateFrom.toISOString().slice(0, 10),
            return: t.dateTo ? t.dateTo.toISOString().slice(0, 10) : null,
            status: t.status,
            bookingUrl:
              t.routes && typeof t.routes === 'object' && 'bookingUrl' in t.routes
                ? (t.routes as { bookingUrl?: string }).bookingUrl
                : null,
          })),
        });
      }
      case 'get_weather': {
        const w = await getWeather(String(input.city || 'Алматы'));
        return JSON.stringify({
          city: w.cityName,
          temp: w.temp,
          feelsLike: w.feelsLike,
          description: w.description,
          wind: w.wind,
          forecast: w.forecast,
        });
      }
      case 'get_goal_progress': {
        // Phase 2.5: связываем память ↔ YearlyGoal ↔ Task. Раньше мозг
        // на «как я иду к цели» отвечал по памяти ИЛИ по факту, не
        // соединяя. Теперь один инструмент собирает всё.
        const now = new Date();
        const year = now.getFullYear();
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);
        const elapsedPct = Math.round(
          ((now.getTime() - yearStart.getTime()) /
            (yearEnd.getTime() - yearStart.getTime())) *
            100,
        );
        const area = input.area ? String(input.area).toLowerCase().trim() : null;

        const goals = await prisma.yearlyGoal.findMany({
          where: {
            userId,
            year,
            ...(area ? { area: { equals: area, mode: 'insensitive' } } : {}),
          },
          select: { area: true, goalText: true, progress: true },
        });

        // Цель-область → категория задач (пересечение доменов).
        const AREA_TO_CAT: Record<string, string> = {
          finance: 'finance',
          health: 'health',
          career: 'work',
          spirituality: 'personal',
        };
        const cats = Array.from(
          new Set(
            goals
              .map((g) => AREA_TO_CAT[g.area.toLowerCase()])
              .filter((c): c is string => !!c),
          ),
        );
        const taskStats: Record<string, { completed: number; total: number }> = {};
        await Promise.all(
          cats.map(async (cat) => {
            const [total, completed] = await Promise.all([
              prisma.task.count({
                where: { userId, category: cat, date: { gte: yearStart } },
              }),
              prisma.task.count({
                where: {
                  userId,
                  category: cat,
                  completed: true,
                  date: { gte: yearStart },
                },
              }),
            ]);
            taskStats[cat] = { completed, total };
          }),
        );

        const memQuery =
          area || goals.map((g) => g.goalText).join(' ') || 'цель';
        const remembered = await getRelevantMemories(userId, memQuery, 5);

        return JSON.stringify({
          yearElapsedPct: elapsedPct,
          goals: goals.map((g) => {
            const pct = g.progress > 1 ? Math.round(g.progress) : Math.round(g.progress * 100);
            const gap = elapsedPct - pct;
            return {
              area: g.area,
              goal: g.goalText,
              progressPct: pct,
              expectedPct: elapsedPct,
              status: gap >= 25 ? 'отстаёт' : gap <= -10 ? 'с опережением' : 'в графике',
              relatedTasks: taskStats[AREA_TO_CAT[g.area.toLowerCase()]] ?? null,
            };
          }),
          remembered: remembered.map((m) => m.content),
        });
      }
      default:
        return `Неизвестный инструмент: ${name}`;
    }
  } catch (err) {
    return `Ошибка инструмента ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
