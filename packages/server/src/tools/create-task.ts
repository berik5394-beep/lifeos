import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateOnlyUTC } from '../lib/tz.js';
import { defineTool } from './_types.js';
import { sanitizeTaskTitle } from '../services/task-title.js';
import {
  estimateTaskMinutesInBackground,
  maybeDayLoadLine,
} from '../services/day-load.js';
import { maybeWeekLoadLine } from '../services/week-load.js';
import { maybeMonthLoadLine } from '../services/month-load.js';

/**
 * SSOT Step 5 — write-tool. Логика 1:1 с legacy action-executor
 * + R9 TZ-coherence (v1.3.2): дата задачи теперь в локальной TZ
 * юзера (read-side get-tasks уже tz-aware — было асимметрично).
 * Обратимо → needsConfirm:false.
 */
export const createTaskTool = defineTool({
  name: 'create_task',
  description:
    'Создать ОДНУ задачу пользователю. Вызывай на «создай задачу», ' +
    '«добавь задачу», «напомни сделать X». Для разбивки БОЛЬШОЙ цели ' +
    'в дерево (план под цель: год → кварталы → недели) — используй ' +
    'decompose_goal, не create_task в цикле.',
  category: 'task',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { name: 'title', taskTitle: 'title', task: 'title', due_date: 'date', dueDate: 'date', deadline: 'date' },
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    category: z.string().max(40).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['создай задачу купить хлеб завтра', 'добавь задачу отчёт'],
  handler: async (input, ctx) => {
    // FIX 2026-06-06: @db.Date = UTC-полночь КАЛЕНДАРНОЙ даты (input.date уже
    // tz-резолвнут resolveDate в локальную дату юзера). Раньше localDayStartUTC
    // писал civil−1 для Almaty (реальный инстант лок. полуночи = 19:00 вчера UTC).
    const date = dateOnlyUTC(input.date);
    // Фикс A: модель оставляет хвостовой предлог/дату в названии
    // («…отчёт на сегодня» → date выдернута, но «на» прилипло). Чистим.
    const title = sanitizeTaskTitle(input.title);
    const task = await prisma.task.create({
      data: {
        userId: ctx.userId,
        title,
        date,
        time: input.time ?? null,
        category: input.category || 'personal',
        priority: input.priority || 'medium',
      },
    });
    const message = `Задача "${title}" создана на ${input.date}${
      input.time ? ' в ' + input.time : ''
    }`;
    // #engine slice1: фоновая ИИ-оценка времени задачи (для точности дня,
    // не блокирует) + реактивная строка «день перегружен». Оба гейтнуты
    // флагом FEATURE_V2_DAY_LOAD внутри (off → message байт-в-байт).
    void estimateTaskMinutesInBackground(
      task.id,
      title,
      input.category ?? null,
      ctx.userId,
    );
    // #engine: каскад горизонтов — показываем самый ближний перегруженный.
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    const weekLoad = dayLoad ? null : await maybeWeekLoadLine(ctx.userId, new Date());
    const monthLoad = dayLoad || weekLoad ? null : await maybeMonthLoadLine(ctx.userId, new Date());
    const extra = dayLoad ?? weekLoad ?? monthLoad;
    // Проактивный конфликт ПРИ СОЗДАНИИ (флаг): timed-задача наложилась на
    // встречу/задачу того же дня → «не успеешь» прямо в ответе. Best-effort.
    let conflictWarn = '';
    try {
      const { isV2ScheduleConflictEnabled } = await import('../lib/feature-flags.js');
      if (input.time && isV2ScheduleConflictEnabled(ctx.userId)) {
        const { findCreationConflict, itemWindow } = await import('../services/schedule-conflict/index.js');
        const w = itemWindow('task', input.time, null);
        if (w) {
          conflictWarn =
            (await findCreationConflict(ctx.userId, date, { title, kind: 'task', ...w }, { taskId: task.id })) ?? '';
        }
      }
    } catch {
      /* best-effort: конфликт не должен ронять создание */
    }
    return {
      message: (extra ? `${message}\n\n${extra}` : message) + conflictWarn,
      taskId: task.id,
    };
  },
});
