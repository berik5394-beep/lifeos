import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * CRM-тип человека — agent-callable. Пишет Entity.attributes.personType
 * (upsertEntity МЕРЖИТ attributes — не затирает birthday/прочее). Reversible/
 * idempotent на каноничном имени → needsConfirm:false. Money-safety: ноль денег.
 */
export const setPersonTypeTool = defineTool({
  name: 'set_person_type',
  description:
    'Пометить тип человека для CRM: клиент / партнёр / инвестор / семья / друг. ' +
    'Вызывай когда юзер называет роль («Ахмет — мой клиент», «Серик мой партнёр по бизнесу»).',
  category: 'memory',
  aliases: { name: 'person', personName: 'person', role: 'type' },
  schema: z.object({
    person: z.string().min(1).max(120).describe('Имя человека, напр. «Ахмет»'),
    type: z
      .enum(['client', 'partner', 'investor', 'family', 'friend'])
      .describe('Тип: client|partner|investor|family|friend (рус. клиент/партнёр/инвестор/семья/друг тоже)'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['Ахмет — мой клиент', 'Серик мой партнёр', 'мама — это семья'],
  handler: async (input, ctx) => {
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: 'person',
      name: input.person,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JsonValue (как set_birthday)
      attributes: { personType: input.type } as any,
      importance: 5,
    });
    const labels: Record<string, string> = {
      client: 'клиент', partner: 'партнёр', investor: 'инвестор', family: 'семья', friend: 'друг',
    };
    return {
      message: `Запомнил: ${input.person} — ${labels[input.type]}.`,
      entityId: entity.id,
    };
  },
});
