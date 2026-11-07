import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

const TYPES = ['client', 'partner', 'investor', 'family', 'friend', 'team'] as const;
type PType = (typeof TYPES)[number];

/** Русские слова → ключ типа (модель часто шлёт «клиент», «сотрудник»). */
const RU: Array<[RegExp, PType]> = [
  [/клиент|заказчик|покупател/, 'client'],
  [/партн/, 'partner'],
  [/инвест/, 'investor'],
  [/семь|родн|мам|пап|брат|сестр|жен|муж|сын|доч/, 'family'],
  [/друг|подруг|друз/, 'friend'],
  [/команд|сотрудн|подчин|работник|коллег|помощни|ассистент|бухгалт|менеджер|юрист|дизайнер|программист|team|employee/, 'team'],
];
export function toPersonType(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase().replace(/ё/g, 'е');
  if ((TYPES as readonly string[]).includes(t)) return t;
  return RU.find(([re]) => re.test(t))?.[1] ?? v;
}

const LABEL: Record<PType, string> = {
  client: 'клиент', partner: 'партнёр', investor: 'инвестор', family: 'семья', friend: 'друг', team: 'команда',
};

/**
 * CRM-тип человека — agent-callable. Пишет Entity.attributes.personType
 * (+ role для команды: «бухгалтер», «продажи»). upsertEntity МЕРЖИТ attributes —
 * не затирает birthday/прочее. Reversible/idempotent на каноничном имени →
 * needsConfirm:false. Money-safety: ноль денег.
 */
export const setPersonTypeTool = defineTool({
  name: 'set_person_type',
  description:
    'Пометить тип человека для CRM: клиент / партнёр / инвестор / семья / друг / команда (сотрудник, с ролью). ' +
    'Вызывай когда юзер называет роль («Ахмет — мой клиент», «Серик мой партнёр», «Айгуль — наш бухгалтер» → team + role). ' +
    'Команда нужна, чтобы робот предлагал «это по части Айгуль — передать?».',
  category: 'memory',
  aliases: { name: 'person', personName: 'person', personType: 'type', position: 'role', job: 'role' },
  schema: z.object({
    person: z.string().min(1).max(120).describe('Имя человека, напр. «Ахмет»'),
    type: z
      .preprocess(toPersonType, z.enum(TYPES))
      .describe('Тип: client|partner|investor|family|friend|team (рус. клиент/партнёр/инвестор/семья/друг/команда тоже)'),
    role: z.string().min(1).max(60).optional().describe('Для команды: чем занимается — «бухгалтер», «продажи», «дизайнер»'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['Ахмет — мой клиент', 'Серик мой партнёр', 'мама — это семья', 'Айгуль — наш бухгалтер'],
  handler: async (input, ctx) => {
    const attributes: Record<string, string> = { personType: input.type };
    if (input.role) attributes.role = input.role.trim();
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: 'person',
      name: input.person,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JsonValue (как set_birthday)
      attributes: attributes as any,
      importance: 5,
    }, { deliberate: true });
    const role = input.role ? ` (${input.role.trim()})` : '';
    return {
      message: `Запомнил: ${input.person} — ${LABEL[input.type]}${role}.`,
      entityId: entity.id,
    };
  },
});
