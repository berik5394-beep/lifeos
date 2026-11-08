import { z } from 'zod';
import { defineTool } from './_types.js';
import { findEventByTitle, lookupMiss, whenText } from '../services/event-change.js';
import { setPendingAction } from '../services/pending-actions.js';

/** Pending-действие удаления: исполняется в runConfirmedAction по id (не tool реестра). */
export const DELETE_EVENT_ACTION = 'delete_event';

/**
 * Отменить (удалить) встречу. НЕОБРАТИМО — поэтому сначала НАХОДИМ встречу в
 * базе и спрашиваем про НЕЁ («Удалить «Встреча с Сериком» 12.11 в 14:00?»),
 * удаляем на «да» по её id (ревью 2026-11-08: раньше подтверждение показывало
 * слова модели, а удаляло то, что нашёл нечёткий матч — могло быть не то).
 * Встреча из Google удаляется и там.
 */
export const cancelEventTool = defineTool({
  name: 'cancel_event',
  description:
    'Отменить/удалить встречу из календаря («отмени встречу с Ахметом», «убери ' +
    'планёрку в пятницу»). date — её день, если одинаковых несколько. Сам спрошу «да».',
  category: 'calendar',
  aliases: { event: 'title', name: 'title', eventTitle: 'title', day: 'date', fromDate: 'date' },
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['отмени встречу с Ахметом', 'удали планёрку в пятницу'],
  handler: async (input, ctx) => {
    const r = await findEventByTitle(ctx.userId, input.title, { date: input.date });
    if (r.kind !== 'one') return { message: lookupMiss(r, input.title, input.date), notFound: r.kind !== 'many' };
    const question = `Удалить встречу «${r.event.title}» ${whenText(r.event)}? Скажи «да» — удалю.`;
    await setPendingAction(ctx.userId, DELETE_EVENT_ACTION, { eventId: r.event.id }, question);
    return { message: question, pending: true, eventId: r.event.id };
  },
});
