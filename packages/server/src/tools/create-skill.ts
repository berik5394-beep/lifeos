/**
 * v2.0 Phase B4 — explicit skill creation tool. The agent calls it when
 * the user says "сделай навык …".
 *
 * needsConfirm:false — saving a skill is a non-money, reversible write
 * (just data; nothing executes at save), exactly like create-task /
 * create-event. CRITICAL: needsConfirm:true would EXCLUDE this tool from
 * agentToolSchemasForUser (the security filter that keeps the autonomous
 * loop off money tools), making create_skill UNREACHABLE — the agent
 * would hallucinate "создал" without ever persisting. Money safety is
 * preserved at RUN time (each skill step keeps its own confirm gate) and
 * at create time (validateSkillTools blocklist).
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
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { name: 'request', description: 'request', task: 'request', goal: 'request', skill: 'request', prompt: 'request' },
  schema,
  needsConfirm: false,
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
