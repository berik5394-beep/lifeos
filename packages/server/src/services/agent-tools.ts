import { prisma } from '../lib/prisma.js';
import { executeAction } from './action-executor.js';

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
      default:
        return `Неизвестный инструмент: ${name}`;
    }
  } catch (err) {
    return `Ошибка инструмента ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
