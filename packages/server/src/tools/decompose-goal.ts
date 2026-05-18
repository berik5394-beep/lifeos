import { z } from 'zod';
import { defineTool } from './_types.js';

/**
 * Phase 5 P2 — шаг 2: decompose_goal в реестре, ЗАГЛУШКА.
 *
 * Цель шага: доказать, что новый planner-tool интегрируется в SSOT
 * (autogen схем/промпта, registry-consistency, агент-цикл, аудит
 * ToolCall) БЕЗ поломок — ДО реализации planner-service. Логика
 * декомпозиции приедет на шаге 3 (YearlyGoal → quarterly) и
 * расширится до полного каскада год→квартал→неделя→привычка/задача.
 *
 * Контракт ответа уже финальный (чтобы P3 только наполнил логику, не
 * меняя форму): decision + tree + message. `decision`:
 *  - 'decompose'   — цель разбивается (обучение/навык/привычка/
 *                     финансы/здоровье)
 *  - 'keep_atomic' — НЕ разбивается (разовая встреча/ДР/покупка) —
 *                     conservative bias на спорном
 *  - 'partial'     — проект с дедлайном → milestones, не дни
 *
 * needsConfirm:false — планировщик пишет ОБРАТИМО и НЕдеструктивно
 * (идемпотентно, не трёт ручное), как create_task. sideEffects:
 * 'write' — реальная версия создаёт WeeklyGoal/Habit/Task с
 * planParentId. На заглушке записи НЕТ.
 */
export const decomposeGoalTool = defineTool({
  name: 'decompose_goal',
  description:
    'Разложить большую цель в дерево: год → кварталы → недели → ' +
    'привычка/задача. Вызывай на «разбей мою цель», «составь план ' +
    'под цель», «как достичь <цель>». Разовые встречи/покупки НЕ ' +
    'разбивает. (Заглушка — логика на шаге 3.)',
  category: 'system',
  schema: z.object({
    goal: z
      .string()
      .min(2)
      .max(300)
      .describe('текст цели, напр. «прочитать 50 книг за год»'),
    goalId: z
      .string()
      .max(64)
      .optional()
      .describe('id существующей YearlyGoal, если разбиваем её'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: [
    'разбей мою цель прочитать 50 книг',
    'составь план под цель накопить миллион',
    'как достичь цели выучить английский',
  ],
  // ЗАГЛУШКА: фиксированный ответ нужной ФОРМЫ. Шаг 3 заменит тело
  // на planner-service (YearlyGoal → quarterly), форма не изменится.
  handler: async (input) => {
    return {
      decision: 'decompose' as const,
      goal: input.goal,
      tree: [],
      message:
        'Планировщик ещё подключается (P2 шаг 3). Пока цель принята, ' +
        'дерево не построено — скоро разложу по кварталам и неделям.',
      stub: true,
    };
  },
});
