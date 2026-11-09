import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateOnlyUTC } from '../lib/tz.js';
import { defineTool } from './_types.js';
import { pickOpenTask } from '../services/task-title.js';
import { proposeReschedule } from '../services/reschedule.js';
import { isV2ScheduleConflictEnabled } from '../lib/feature-flags.js';
import { findCreationConflict, itemWindow } from '../services/schedule-conflict/index.js';
import { fmtDay } from '../services/event-change.js';

/**
 * Перенести ОДНУ задачу на другой день/время (defer_overdue двигает только все
 * просроченные разом). Робот сам предлагал «перенести?» — а сделать было нечем.
 * Обратимо. После — проверка наложения и перегруза нового дня.
 */
export const moveTaskTool = defineTool({
  name: 'move_task',
  description:
    'ПЕРЕНЕСТИ одну задачу на другой день и/или время («перенеси отчёт на ' +
    'завтра», «звонок маме на 19:00»). newTime: "" — убрать время. Все ' +
    'просроченные разом — defer_overdue, не я.',
  category: 'task',
  aliases: { task: 'title', taskTitle: 'title', name: 'title', toDate: 'newDate', to: 'newDate', date: 'newDate', time: 'newTime', new_time: 'newTime' },
  schema: z.object({
    title: z.string().min(1).max(300),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    newTime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['перенеси отчёт на завтра', 'звонок маме перенеси на 19:00'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    if (!input.newDate && input.newTime === undefined) return { message: `На когда перенести «${input.title}»?`, needsInput: true };
    const candidates = await prisma.task.findMany({
      where: { userId, completed: false, cancelled: false },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    // pickOpenTask, а не «новейшая подходящая»: «звонок» при «Звонок маме» и
    // «Звонок в банк» — переспросить, а не двигать наугад (как complete/cancel).
    const pick = pickOpenTask(input.title, candidates);
    if (pick.kind === 'none') return { message: `Не нашёл открытую задачу «${input.title}».`, notFound: true };
    if (pick.kind === 'many') {
      return { message: `Какую перенести: ${pick.tasks.slice(0, 4).map((t) => `«${t.title}»`).join(', ')}?`, needsInput: true };
    }
    const task = pick.task;

    const date = input.newDate ? dateOnlyUTC(input.newDate) : task.date;
    const time = input.newTime === undefined ? task.time : input.newTime || null;
    const r = await prisma.task.updateMany({ where: { id: task.id, userId }, data: { date, time } });
    if (r.count === 0) return { message: `Не нашёл открытую задачу «${input.title}».`, notFound: true };

    const day = date.toISOString().slice(0, 10);
    let conflict = '';
    if (time && isV2ScheduleConflictEnabled(userId)) {
      const w = itemWindow('task', time, null);
      if (w) conflict = (await findCreationConflict(userId, date, { title: task.title, kind: 'task', ...w }, { taskId: task.id }).catch(() => null)) ?? '';
    }
    const dateChanged = task.date.getTime() !== date.getTime();
    const rs = dateChanged ? await proposeReschedule(userId, day, task.id) : null;
    const msg = `Перенёс задачу «${task.title}» на ${fmtDay(day)}${time ? ` в ${time}` : ''}.${conflict}`;
    return { message: rs ? `${msg}\n\n${rs.text}` : msg, taskId: task.id, ...(rs?.staged ? { rescheduleStaged: true } : {}) };
  },
});
