import { z } from 'zod';
import { defineTool } from './_types.js';
import { persistPlan } from '../services/planner-service.js';

/**
 * Phase 5 P2/3 — decompose_goal: реальный planner-tool в SSOT registry.
 *
 * Handler вызывает persistPlan() из planner-service.js — РЕАЛЬНАЯ
 * декомпозиция (год → кварталы → недели → привычка/задача), пишет
 * WeeklyGoal/Habit/Task с planParentId. Не выдумывает — counter
 * `created` отражает РЕАЛЬНО созданные строки (bug-#1 класс защиты).
 *
 * Контракт ответа: decision + tree + message. `decision`:
 *  - 'decompose'   — цель разбивается (обучение/навык/привычка/
 *                     финансы/здоровье)
 *  - 'keep_atomic' — НЕ разбивается (разовая встреча/ДР/покупка) —
 *                     conservative bias на спорном
 *  - 'partial'     — проект с дедлайном → milestones, не дни
 *
 * needsConfirm:false — планировщик пишет ОБРАТИМО и НЕдеструктивно
 * (идемпотентно, не трёт ручное), как create_task. sideEffects:
 * 'write' — реальные записи в WeeklyGoal/Habit/Task с planParentId.
 *
 * История: на Phase 5 шаг 2 это была заглушка (доказать SSOT-интеграцию
 * без поломок ДО planner-service). На шаге 3d (P3.d) handler заменён
 * на реальный persistPlan, форма ответа сохранена. Комментарии
 * обновлены 2026-05-26 (устаревали ещё с май 2026).
 */
export const decomposeGoalTool = defineTool({
  name: 'decompose_goal',
  description:
    'Разложить большую цель в дерево: год → кварталы → недели → ' +
    'привычка/задача. Вызывай на «разбей мою цель», «составь план ' +
    'под цель», «как достичь <цель>». Разовые встречи/покупки НЕ ' +
    'разбивает.',
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
