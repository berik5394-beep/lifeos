import { z } from 'zod';
import { defineTool } from './_types.js';
import { findEventByTitle, googleNote, lookupMiss, moveEvent, whenText } from '../services/event-change.js';
import { proposeReschedule } from '../services/reschedule.js';
import { isV2ScheduleConflictEnabled } from '../lib/feature-flags.js';
import { findCreationConflict, itemWindow } from '../services/schedule-conflict/index.js';

/**
 * Перенести СУЩЕСТВУЮЩУЮ встречу (дата и/или время). Раньше «перенеси» шло в
 * create_event и создавало ВТОРУЮ встречу (старая оставалась с напоминаниями).
 * Длительность сохраняется; встреча из Google переносится и там. После —
 * проверка наложения и перегруза нового дня. Обратимо (перенести обратно).
 */
const HM = /^\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const moveEventTool = defineTool({
  name: 'move_event',
  description:
    'ПЕРЕНЕСТИ существующую встречу на другой день и/или время («перенеси ' +
    'встречу с Сериком на 16:00», «планёрку на пятницу»). title — какую; date — ' +
    'её текущий день, если одинаковых несколько; newDate/newStartTime/newEndTime — ' +
    'куда. Длительность сохраняю. Новую встречу — create_event, не я.',
  category: 'calendar',
  aliases: {
    event: 'title', name: 'title', eventTitle: 'title',
    fromDate: 'date', from: 'date', currentDate: 'date',
    toDate: 'newDate', to: 'newDate', new_date: 'newDate',
    startTime: 'newStartTime', time: 'newStartTime', newTime: 'newStartTime', new_time: 'newStartTime',
    endTime: 'newEndTime',
  },
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(DAY).optional(),
    newDate: z.string().regex(DAY).optional(),
    newStartTime: z.string().regex(HM).optional(),
    newEndTime: z.string().regex(HM).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['перенеси встречу с Сериком на 16:00', 'планёрку перенеси на пятницу'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // «планёрку на пятницу» модель часто кладёт в date: нового нет, дата есть —
    // это и есть КУДА, а не «какую из одинаковых».
    const onlyDate = !input.newDate && !input.newStartTime && !input.newEndTime && !!input.date;
    const target: { title: string; date?: string; newDate?: string; newStartTime?: string; newEndTime?: string } =
      onlyDate ? { ...input, newDate: input.date, date: undefined } : { ...input };
    if (!target.newDate && !target.newStartTime && !target.newEndTime) {
      return { message: `На когда перенести «${input.title}»?` };
    }
    let lookup = await findEventByTitle(userId, target.title, { date: target.date });
    // {date, startTime} как у create_event («в пятницу в 16:00» = КУДА): на эту
    // дату такой встречи нет, а newDate не дали — значит date и есть новая дата.
    if (lookup.kind === 'none_on_date' && !target.newDate && target.date) {
      target.newDate = target.date;
      target.date = undefined;
      lookup = await findEventByTitle(userId, target.title, {});
    }
    if (lookup.kind !== 'one') {
      return { message: lookupMiss(lookup, input.title, target.date), notFound: lookup.kind !== 'many' };
    }
    const found = lookup;

    const r = await moveEvent(userId, found.event.id, {
      date: target.newDate,
      startTime: target.newStartTime,
      endTime: target.newEndTime,
    });
    if (!r) return { message: `Не нашёл встречу «${input.title}» в календаре.`, notFound: true };
    const { before, after, google } = r;
    const newDay = after.date.toISOString().slice(0, 10);

    let conflict = '';
    if (after.startTime && isV2ScheduleConflictEnabled(userId)) {
      const w = itemWindow('event', after.startTime, after.endTime);
      if (w) {
        conflict =
          (await findCreationConflict(userId, after.date, { title: after.title, kind: 'event', ...w }, { eventId: after.id }).catch(() => null)) ?? '';
      }
    }
    const rs = after.startTime && after.endTime ? await proposeReschedule(userId, newDay, null) : null;
    const which = found.sameTitle > 1 && !target.date ? ' (ближайшую)' : '';
    const msg = `Перенёс «${after.title}»${which} с ${whenText(before)} на ${whenText(after)}.${googleNote(google, 'patch')}${conflict}`;
    return {
      message: rs ? `${msg}\n\n${rs.text}` : msg,
      eventId: after.id,
      ...(rs?.staged ? { rescheduleStaged: true } : {}),
    };
  },
});
