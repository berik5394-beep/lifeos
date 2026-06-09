import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';
import { parseBirthday } from '../services/birthday/types.js';

/**
 * Память ДР — agent-callable. Записывает день рождения человека в
 * Entity.attributes.birthday. upsertEntity мержит attributes (не затирает
 * прочие ключи). Reversible/idempotent на каноничном имени → needsConfirm:false.
 * Money-safety: пишет ТОЛЬКО память, ноль денег.
 */
export const setBirthdayTool = defineTool({
  name: 'set_birthday',
  description:
    'Запомнить день рождения человека. Вызывай когда юзер называет ДР — ' +
    'явно («запомни, у Ахмета ДР 12 мая») или вскользь («у Серика др завтра, ' +
    '8 июня»). Год опционален.',
  category: 'memory',
  aliases: { name: 'person', personName: 'person' },
  schema: z.object({
    person: z.string().min(1).max(120).describe('Имя человека, напр. «Ахмет»'),
    // z.coerce: LLM часто шлёт числа строками ({"day":"25"}). Коэрсим до int,
    // иначе z.number() отвергает строку и инструмент молча падает (прод-баг 2026-06-05).
    day: z.coerce.number().int().min(1).max(31).describe('День, напр. 12'),
    month: z.coerce.number().int().min(1).max(12).describe('Месяц числом 1-12, напр. 5 (май)'),
    year: z.coerce.number().int().min(1900).max(2100).optional().describe('Год рождения, если известен'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запомни у Ахмета ДР 12 мая', 'у Серика день рождения 8 июня'],
  handler: async (input, ctx) => {
    const bday = parseBirthday({ day: input.day, month: input.month, year: input.year });
    if (!bday) {
      return { message: 'Не понял дату ДР — проверь день и месяц.' };
    }
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: 'person',
      name: input.person,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JsonValue (как в remember-entity)
      attributes: { birthday: bday } as any,
      importance: 5,
    }, { deliberate: true });
    const yearPart = bday.year ? `.${bday.year}` : '';
    return {
      message: `Запомнил: ДР ${input.person} — ${bday.day}.${bday.month}${yearPart}`,
      entityId: entity.id,
    };
  },
});
