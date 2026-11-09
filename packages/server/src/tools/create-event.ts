import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { dateOnlyUTC } from '../lib/tz.js';
import { defineTool } from './_types.js';
import { proposeReschedule } from '../services/reschedule.js';

/**
 * SSOT Step 5 — write-tool. Anti-dup: если есть событие с ТЕМ ЖЕ
 * title (полное совпадение, case-insensitive) в окне ±3 дня и тем
 * же startTime — ОБНОВЛЯЕМ, не плодим дубль.
 *
 * Phase 7 (L99 audit #9 fix): раньше match'или по `title.slice(0,40)`
 * — это **уничтожало данные** (две разные встречи с общим префиксом
 * затирали друг друга, e.g. «Встреча с Сериком — поставщик» и
 * «Встреча с Сериком — клиент»). Теперь:
 *   1. ПОЛНЫЙ title (case-insensitive, trimmed)
 *   2. Same startTime (null-null или equal) — две встречи в один
 *      день в разное время остаются раздельными
 *   3. ±3 дня по date
 *
 * Overwrite (UPDATE) логируется через console.warn для audit trail.
 */
export const createEventTool = defineTool({
  name: 'create_event',
  description:
    'Создать НОВУЮ встречу/событие в календаре: с людьми, местом или ' +
    'временем «с–до». Перенести существующую — move_event, отменить — ' +
    'cancel_event, не я. Дело без встречи («купить», «сделать отчёт», ' +
    '«позвонить») — create_task.',
  category: 'calendar',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { name: 'title', eventTitle: 'title', due_date: 'date', dueDate: 'date', day: 'date', place: 'location', desc: 'description', notes: 'description', note: 'description' },
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    location: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запиши встречу с Сериком завтра в 14:00'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const title = input.title;
    // R9 TZ coherence (v1.3.2): дата → UTC instant начала локального
    // дня юзера. Mid-day UTC trick гарантирует попадание в нужный
    // локальный день для любой tz. Symmetric с get-calendar
    // (read tz-aware с v1.3.0) — раньше read и write смотрели на
    // разные UTC instants для одного локального дня → встреча могла
    // «исчезнуть» из view для юзера в Almaty.
    // FIX 2026-06-06: @db.Date = UTC-полночь календарной даты (input.date уже civil).
    const date = dateOnlyUTC(input.date);
    const startTime = input.startTime ?? null;
    const endTime = input.endTime ?? null;

    // Anti-dup: та же встреча в ТОТ ЖЕ день и время (повтор просьбы) — не плодим копию.
    // Аудит 2026-11-09: раньше окно ±3 дня — «запиши планёрку в четверг 10:00»
    // ПЕРЕНОСИЛО понедельничную «Планёрку» 10:00 (новой не было). Перенос — move_event.
    const normalizedTitle = title.trim();
    const existingEv = await prisma.calendarEvent.findFirst({
      where: {
        userId,
        title: { equals: normalizedTitle, mode: 'insensitive' },
        date,
        // null-null или equal — две встречи в один день в разное время
        // остаются раздельными
        startTime,
      },
      orderBy: { date: 'desc' },
    });

    if (existingEv) {
      // Audit trail: overwrite видно в логах (раньше silent merge
      // уничтожал данные без следа).
      console.warn(
        `[create_event] UPDATE existing event id=${existingEv.id} title="${existingEv.title}" date=${existingEv.date.toISOString().slice(0,10)} startTime=${existingEv.startTime ?? 'null'} (user=${userId})`,
      );
      const updated = await prisma.calendarEvent.update({
        where: { id: existingEv.id },
        data: {
          title,
          date,
          startTime,
          endTime,
          location: input.location ?? existingEv.location,
          description: input.description ?? existingEv.description,
        },
      });
      // Перегруз дня (флаг): встреча съела время дня → предложить сдвинуть задачи.
      // Только если время/день встречи реально поменялись (как PUT /events).
      const timeChanged =
        existingEv.date.getTime() !== date.getTime() ||
        existingEv.startTime !== startTime ||
        existingEv.endTime !== endTime;
      const rs = timeChanged && startTime && endTime ? await proposeReschedule(userId, input.date, null) : null;
      const msg = `Обновил встречу «${title}»: ${input.date}${
        startTime ? ' в ' + startTime : ''
      } (была одна запись — не плодил дубль)`;
      return {
        message: rs ? `${msg}\n\n${rs.text}` : msg,
        eventId: updated.id,
        updated: true,
        ...(rs?.staged ? { rescheduleStaged: true } : {}),
      };
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        title,
        date,
        startTime,
        endTime,
        location: input.location ?? null,
        description: input.description ?? null,
        source: 'voice',
      },
    });
    // Проактивный конфликт ПРИ СОЗДАНИИ (флаг): встреча наложилась на задачу/
    // встречу того же дня → «не успеешь» прямо в ответе. Best-effort.
    let conflictWarn = '';
    try {
      const { isV2ScheduleConflictEnabled } = await import('../lib/feature-flags.js');
      if (startTime && isV2ScheduleConflictEnabled(userId)) {
        const { findCreationConflict, itemWindow } = await import('../services/schedule-conflict/index.js');
        const w = itemWindow('event', startTime, endTime);
        if (w) {
          conflictWarn =
            (await findCreationConflict(userId, date, { title, kind: 'event', ...w }, { eventId: event.id })) ?? '';
        }
      }
    } catch {
      /* best-effort: конфликт не должен ронять создание */
    }
    // Перегруз дня (флаг): встреча съела время дня → предложить сдвинуть задачи.
    // Только для встречи с началом и концом (без них времени она не занимает).
    const rs = startTime && endTime ? await proposeReschedule(userId, input.date, null) : null;
    const base = `Встреча "${title}" создана на ${input.date}${startTime ? ' в ' + startTime : ''}`;
    return {
      message: rs ? `${base}${conflictWarn}\n\n${rs.text}` : base + conflictWarn,
      eventId: event.id,
      updated: false,
      ...(rs?.staged ? { rescheduleStaged: true } : {}),
    };
  },
});
