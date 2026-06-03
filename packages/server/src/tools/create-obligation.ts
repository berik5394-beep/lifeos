import { z } from 'zod';
import { defineTool } from './_types.js';
import { createObligation } from '../services/obligations/index.js';
import { normalizeDirection } from '../services/obligations/types.js';
import { isV2ObligationsEnabled } from '../lib/feature-flags.js';

export const createObligationTool = defineTool({
  name: 'create_obligation',
  description:
    'Записать обязательство: что ты обещал человеку ИЛИ что обещали тебе ' +
    '(действие или деньги), с человеком и сроком. Вызывай на «я должен X», ' +
    '«я обещал X», «X должен мне», «X обещал прислать».',
  category: 'memory',
  aliases: {
    who: 'personName',
    person: 'personName',
    name: 'personName',
    what: 'description',
    amount_money: 'amount',
    due: 'dueDate',
    date: 'dueDate',
  },
  schema: z.object({
    personName: z.string().max(120),
    direction: z.string().max(40),
    kind: z.enum(['action', 'money']).default('action'),
    description: z.string().max(500),
    amount: z.number().positive().nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .nullable()
      .optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: [
    'я должен Серику договор к пятнице',
    'Ахмет должен мне 500000',
    'я обещал маме позвонить завтра',
  ],
  handler: async (input, ctx) => {
    if (!isV2ObligationsEnabled(ctx.userId)) return { error: 'функция отключена' };
    const direction = normalizeDirection(String(input.direction || ''));
    if (!direction) return { error: 'не понял направление (я должен / мне должны)' };
    const created = await createObligation({
      userId: ctx.userId,
      personName: String(input.personName).trim(),
      direction,
      kind: input.kind === 'money' ? 'money' : 'action',
      description: String(input.description).trim(),
      amount: input.amount ?? null,
      dueDate: input.dueDate ? new Date(String(input.dueDate)) : null,
      source: 'manual',
    });
    return { ok: true, id: created.id, personName: created.personName };
  },
});
