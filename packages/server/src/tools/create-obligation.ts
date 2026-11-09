import { z } from 'zod';
import { defineTool } from './_types.js';
import { createObligation } from '../services/obligations/index.js';
import { normalizeDirection } from '../services/obligations/types.js';

export const createObligationTool = defineTool({
  name: 'create_obligation',
  description:
    'Записать обязательство: что ты обещал человеку ИЛИ что обещали тебе ' +
    '(действие или деньги), с человеком и сроком. Вызывай на «я должен X», ' +
    '«я обещал X», «X должен мне», «X обещал прислать». Только когда есть ' +
    'ДРУГОЙ человек и обещание; «надо сделать X» без человека — create_task, не я. ' +
    'Шаг продажи («отправил КП», «договор») — update_deal. ' +
    'ЗАЁМ («Ахмет занял у меня 100 тысяч», «одолжил Серику 50к», «взял в долг у брата») — ' +
    'это я, kind="money", amount, СРАЗУ без вопроса «да?» (не доход/расход). ' +
    'Не обещай «запишу после да» — либо вызови меня, либо скажи, чего не хватает.',
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
    // Без kind, но с суммой — это деньги (аудит 2026-11-09: «Ахмет должен мне 500к»
    // без kind сохранялось действием, сумма терялась, в «Долгах» его не было).
    kind: z.enum(['action', 'money']).optional(),
    description: z.string().max(500),
    amount: z.coerce.number().positive().nullable().optional(),
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
    'Ахмет занял у меня 100 тысяч',
    'я обещал маме позвонить завтра',
  ],
  handler: async (input, ctx) => {
    const direction = normalizeDirection(String(input.direction || ''));
    if (!direction) return { error: 'не понял направление (я должен / мне должны)' };
    const created = await createObligation({
      userId: ctx.userId,
      personName: String(input.personName).trim(),
      direction,
      kind: input.kind === 'money' || (input.kind === undefined && input.amount != null && input.amount > 0) ? 'money' : 'action',
      description: String(input.description).trim(),
      amount: input.amount ?? null,
      dueDate: input.dueDate ? new Date(String(input.dueDate)) : null,
      source: 'manual',
    });
    return { ok: true, id: created.id, personName: created.personName };
  },
});
