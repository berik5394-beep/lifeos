import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localDateStr, addCivilDays, dateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { mondayOf } from '../services/reflection-context.js';

/**
 * Дневник (сон/энергия/настроение 1–10/записи) + заметки недели.
 * Раньше journal_entry был только на запись — прочитать «как я спал на
 * неделе» мозг не мог.
 */
export const getJournalTool = defineTool({
  name: 'get_journal',
  description:
    'Дневник самочувствия за последние дни (сон в часах, энергия и настроение 1–10, записи) ' +
    'и заметки недели (что получилось / что улучшить / благодарность). ' +
    'Вызывай на «как я спал», «какое у меня настроение было на неделе», «что я писал в дневнике».',
  category: 'memory',
  schema: z.object({ days: z.coerce.number().int().min(1).max(31).optional() }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['как я спал на этой неделе', 'что я писал в дневнике'],
  handler: async (input, ctx) => {
    const tz = await getUserTimezone(ctx.userId);
    const today = localDateStr(tz);
    const days = input.days ?? 7;
    const [rows, note] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { userId: ctx.userId, date: { gte: dateOnlyUTC(addCivilDays(today, -(days - 1))), lte: dateOnlyUTC(today) } },
        select: { date: true, sleepHours: true, energy: true, mood: true, notes: true },
        orderBy: { date: 'asc' },
      }),
      prisma.weekNote.findUnique({
        where: { userId_weekStart: { userId: ctx.userId, weekStart: dateOnlyUTC(mondayOf(today)) } },
        select: { notes: true, improve: true, gratitude: true, wins: true },
      }),
    ]);
    return {
      today,
      scale: 'энергия и настроение 1–10',
      entries: rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        sleepHours: r.sleepHours,
        energy: r.energy,
        mood: r.mood,
        notes: r.notes,
      })),
      weekNotes: note,
    };
  },
});
