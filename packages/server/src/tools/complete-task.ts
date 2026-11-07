import { z } from 'zod';
import { kanbanForCompletion } from '../services/kanban-signals.js';
import { prisma } from '../lib/prisma.js';
import { matchOpenTask } from '../services/task-title.js';
import { defineTool } from './_types.js';
import { onTaskCompleted } from '../services/coins.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy complete_task. */
export const completeTaskTool = defineTool({
  name: 'complete_task',
  description:
    'Отметить задачу выполненной. Вызывай на «закрой задачу X», ' +
    '«сделал X», «выполнил задачу X», «X готово», если X — разовое дело из ' +
    'задач. Если X — привычка (бег, чтение, зарядка из списка привычек) — ' +
    'complete_habit, не я.',
  category: 'task',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { taskTitle: 'title', task: 'title', name: 'title', task_title: 'title' },
  schema: z.object({
    title: z.string().max(300).optional(),
    taskId: z.string().max(60).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['закрой задачу отчёт', 'выполнил задачу купить хлеб'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    let task = input.taskId
      ? await prisma.task.findFirst({ where: { id: input.taskId, userId } })
      : null;
    if (!task && input.title) {
      // Фикс B: голый `contains` промахивался при рассинхроне длины
      // («…отчёт на сегодня» vs хранимое «…отчёт»). matchOpenTask чистит
      // обе стороны + двунаправленный матч + самый свежий.
      const candidates = await prisma.task.findMany({
        where: { userId, completed: false, cancelled: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      task = matchOpenTask(input.title, candidates);
    }
    if (!task) return { message: 'Задача не найдена', notFound: true };
    await prisma.task.update({
      where: { id: task.id },
      data: { completed: true, ...kanbanForCompletion(true, task.kanbanStatus) },
    });
    // Часть 6: монеты за дело — так же, как из приложения.
    await onTaskCompleted(userId, task.id, task.title);
    return { message: `Задача "${task.title}" выполнена ✅`, taskId: task.id };
  },
});
