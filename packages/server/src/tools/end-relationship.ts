import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';
import { isV2UnlinkEnabled } from '../lib/feature-flags.js';

export const endRelationshipTool = defineTool({
  name: 'end_relationship',
  description:
    'Завершить/убрать отношение с человеком, местом или организацией. Вызывай на «уже не работаю с X», «мы расстались», «развёлся с Y», «уволился из X». Обратимо.',
  category: 'memory',
  aliases: { person: 'name', who: 'name', entity: 'name', whom: 'name' },
  schema: z.object({ name: z.string().min(1).max(255) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['уже не работаю с Сериком', 'мы расстались с Айгерим', 'уволился из Kaspi'],
  handler: async (input, ctx) => {
    if (!isV2UnlinkEnabled(ctx.userId)) return { error: 'функция отключена' };
    const graph = getEntityGraph();
    const ent = await graph.resolveEntity(ctx.userId, String(input.name));
    if (!ent) return { error: `Не нашёл «${input.name}» в связях` };
    const links = await graph.activeLinksForEntity(ctx.userId, ent.id);
    if (links.length === 0) return { ok: true, message: `У тебя нет активной связи с «${ent.name}»` };
    if (links.length > 1) return { ok: true, message: `У тебя несколько связей с «${ent.name}» — уточни, какую убрать?` };
    await graph.invalidateLink(ctx.userId, links[0].id);
    return { ok: true, ended: true, message: `Убрал связь с «${ent.name}» (можно вернуть)` };
  },
});
