import { z } from 'zod';
import { defineTool } from './_types.js';
import { listObligations } from '../services/obligations/index.js';
import { normalizeDirection } from '../services/obligations/types.js';
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';

export const listObligationsTool = defineTool({
  name: 'list_obligations',
  description:
    'Показать открытые обязательства: что ты кому должен и кто должен тебе. ' +
    'Read-only. Вызывай на «что я кому должен», «кто мне должен», «мои обещания».',
  category: 'memory',
  aliases: { person: 'personName', who: 'personName' },
  schema: z.object({
    direction: z.string().max(40).nullable().optional(),
    personName: z.string().max(120).nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что я кому должен', 'кто мне должен', 'мои обещания Серику'],
  handler: async (input, ctx) => {
    if (!isV2ObligationsEnabled(ctx.userId)) return { obligations: [] };
    const dir = input.direction ? normalizeDirection(String(input.direction)) : null;
    const rows = await listObligations(ctx.userId, {
      status: 'open',
      direction: dir ?? undefined,
      personName: input.personName ? String(input.personName) : undefined,
    });
    return {
      obligations: rows.map((o) => ({
        id: o.id,
        direction: o.direction,
        kind: o.kind,
        person: o.personName,
        description: o.description,
        amount: o.amount,
        due: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
      })),
    };
  },
});
