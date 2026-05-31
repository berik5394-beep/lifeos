/**
 * v2.0 Phase B4 — explicit skill creation tool. The agent calls it when
 * the user says "сделай навык …". needsConfirm:true — the drafted skill
 * is shown for confirmation before it is saved.
 */

import { z } from 'zod';
import { defineTool } from './_types.js';
import { buildSkillFromRequest, getHermesStore } from '../services/hermes/index.js';

const schema = z.object({
  request: z.string().min(1).describe('Что должен делать навык, словами пользователя'),
});

export const createSkillTool = defineTool({
  name: 'create_skill',
  description:
    'Создать новый навык (сохранённый рецепт из существующих инструментов) ' +
    'по запросу пользователя. Используй, когда пользователь просит ' +
    '«сделай навык», «запомни это как навык».',
  category: 'system',
  schema,
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['сделай навык утренний брифинг', 'запомни это как навык'],
  handler: async (input, ctx): Promise<string> => {
    const spec = await buildSkillFromRequest(ctx.userId, input.request);
    if (!spec) {
      return 'Не получилось собрать навык из запроса. Уточни, что он должен делать.';
    }
    try {
      const saved = await getHermesStore().createSkill(ctx.userId, spec, 'explicit');
      const steps = (spec.plan ?? []).map((s) => s.toolName).join(' → ');
      return `Готово — создал навык «${saved.name}»: ${steps}. ` +
        `Запусти словами: ${(spec.triggers[0] ?? saved.name)}.`;
    } catch (err) {
      return `Навык не прошёл проверку безопасности: ` +
        `${err instanceof Error ? err.message : 'неизвестная ошибка'}.`;
    }
  },
});
