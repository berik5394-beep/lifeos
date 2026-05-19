import { z } from 'zod';
import { defineTool } from './_types.js';
import { persistPlan } from '../services/planner-service.js';

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
    rebuild: z
      .boolean()
      .optional()
      .describe(
        'true — пересобрать существующий план заново (старый ' +
          'архивируется, прогресс сохраняется в истории). Ставь, ' +
          'когда юзер просит «перестрой/пересобери план».',
      ),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: [
    'разбей мою цель прочитать 50 книг',
    'составь план под цель накопить миллион',
    'как достичь цели выучить английский',
  ],
  // 3d: реальный planner-service. persistPlan сам честен —
  // keep_atomic / null-дерево / идемпотентный skip → created:0 +
  // честный текст, НИКОГДА не выдумывает (bug-#1 класс). Счётчик
  // created = РЕАЛЬНО созданные строки (как materializeImport).
  handler: async (input, ctx) => {
    const r = await persistPlan(
      ctx.userId,
      input.goal,
      input.goalId,
      input.rebuild === true,
    );
    return {
      decision: r.decision,
      created: r.created,
      goalId: r.goalId ?? null,
      message: r.message,
    };
  },
});
