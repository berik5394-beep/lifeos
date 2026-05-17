import { prisma } from '../lib/prisma.js';
import { executeAction } from './action-executor.js';
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
    name: 'get_email_triage',
    description:
      'Разобрать непрочитанные письма Gmail: что важное, что можно проигнорировать. Read-only. Вызывай на «разбери почту», «что в почте», «есть важные письма».',
    input_schema: { type: 'object', properties: {} },
  },
  {
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
        const date = input.date
          ? new Date(String(input.date) + 'T00:00:00Z')
          : startOfDay(new Date());
        const tasks = await prisma.task.findMany({
          where: {
            userId,
            date,
            ...(input.includeCompleted ? {} : { completed: false }),
          },
          select: { title: true, time: true, priority: true, completed: true },
          orderBy: { time: 'asc' },
          take: 50,
        });
        return JSON.stringify(tasks);
      }
      case 'get_calendar': {
        const events = await prisma.calendarEvent.findMany({
          where: {
            userId,
            date: {
              gte: new Date(String(input.from) + 'T00:00:00Z'),
              lte: new Date(String(input.to) + 'T00:00:00Z'),
            },
          },
          select: { title: true, date: true, startTime: true, endTime: true, location: true },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
          take: 100,
        });
        return JSON.stringify(
          events.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
        );
      }
      case 'get_budget': {
        const r = await executeAction('get_budget_analysis', {}, userId);
        return JSON.stringify(r.data ?? r.message);
      }
      case 'create_task': {
        const r = await executeAction('create_task', input, userId);
        return r.message;
      }
      case 'create_event': {
        const r = await executeAction('create_event', input, userId);
        return r.message;
      }
      case 'complete_habit': {
        const r = await executeAction('complete_habit', { name: input.name }, userId);
        return r.message;
      }
      case 'get_email_triage': {
        const t = await triageInbox(userId);
        return JSON.stringify({
          summary: t.summary,
          important: t.important.map((m) => ({ from: m.from, subject: m.subject })),
        });
      }
      case 'recall_person': {
        // Phase 2.1: структурная связка person ↔ ContactCache. Раньше
        // память о людях была плоским текстом без связи с контактами —
        // Джарвис не мог «вспомнить человека» (кто, телефон, контекст).
        const name = String(input.name || '').trim();
        if (!name) return JSON.stringify({ error: 'имя не указано' });
        const [contacts, mem] = await Promise.all([
          prisma.contactCache.findMany({
            where: { userId, name: { contains: name, mode: 'insensitive' } },
            select: { name: true, phone: true, email: true, birthday: true },
            take: 3,
          }),
          getRelevantMemories(userId, name, 6),
        ]);
        return JSON.stringify({
          contacts: contacts.map((c) => ({
            name: c.name,
            phone: c.phone,
            email: c.email,
            birthday: c.birthday ? c.birthday.toISOString().slice(0, 10) : null,
          })),
          remembered: mem
            .filter(
              (m) =>
                m.type === 'person' ||
                m.content.toLowerCase().includes(name.toLowerCase()),
            )
            .map((m) => m.content),
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
