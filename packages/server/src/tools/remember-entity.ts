import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * v2.0 Week 5 — agent-callable memory tool. Lets the bot persist a new
 * entity (person/place/concept/goal/org) explicitly: «запомни маму» or
 * after relationship extraction inside a conversation. Reversible
 * (upsert is idempotent on canonical name) → needsConfirm:false.
 */
export const rememberEntityTool = defineTool({
  name: 'remember_entity',
  description:
    'Запомнить (или обновить) entity в долгосрочной памяти юзера: ' +
    'человека, место, концепцию, цель, организацию. Вызывай когда юзер ' +
    'явно просит «запомни X» или когда из разговора выделил нового важного.',
  category: 'memory',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { entityType: 'type', entityName: 'name', title: 'name' },
  schema: z.object({
    type: z.enum(['person', 'place', 'concept', 'goal', 'organization']),
    name: z.string().min(1).max(120),
    attributes: z.record(z.unknown()).optional(),
    importance: z.coerce.number().int().min(1).max(10).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запомни маму', 'запомни Серика как коллегу'],
  handler: async (input, ctx) => {
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: input.type,
      name: input.name,
      attributes: (input.attributes ?? {}) as any,
      importance: input.importance ?? 5,
    });
    return {
      message: `Запомнил: ${entity.name}`,
      entityId: entity.id,
    };
  },
});
