import { z } from 'zod';
import { defineTool } from './_types.js';
import { cancelObligation } from '../services/obligations/index.js';

export const cancelObligationTool = defineTool({
  name: 'cancel_obligation',
  description:
    'Отменить обязательство (больше не актуально). Вызывай на «отмени обязательство», «уже не должен».',
  category: 'memory',
  aliases: { obligation_id: 'id' },
  schema: z.object({ id: z.string().max(64) }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отмени обязательство', 'это уже не актуально'],
  handler: async (input, ctx) => {
    const c = await cancelObligation(ctx.userId, String(input.id));
    if (!c) return { error: 'обязательство не найдено' };
    return { ok: true, cancelled: true };
  },
});
