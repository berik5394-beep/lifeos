import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy journal_entry (upsert на сегодня). */
export const journalEntryTool = defineTool({
  name: 'journal_entry',
  description:
    'Записать/обновить дневник самочувствия за сегодня (сон, энергия, ' +
    'настроение, заметки). Вызывай на «спал X часов», «настроение Y», ' +
    '«запиши в дневник», «энергия Z». НЕ путать с create_task — это ' +
    'субъективное состояние, не дело.',
  category: 'task',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { note: 'notes', text: 'notes', comment: 'notes' },
  schema: z.object({
    sleepHours: z.coerce.number().min(0).max(24).optional(),
    energy: z.coerce.number().int().min(1).max(10).optional(),
    mood: z.coerce.number().int().min(1).max(10).optional(),
    notes: z.string().max(2000).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['спал 7 часов, настроение 8', 'запиши в дневник: устал'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    // R9 TZ-aware: «сегодня» в локальной TZ юзера.
    const tz = await getUserTimezone(userId);
    const today = localDayStartUTC(tz);
    const entry = await prisma.journalEntry.upsert({
      where: { userId_date: { userId, date: today } },
      update: {
        ...(input.sleepHours !== undefined && { sleepHours: input.sleepHours }),
        ...(input.energy !== undefined && { energy: input.energy }),
        ...(input.mood !== undefined && { mood: input.mood }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      create: {
        userId,
        date: today,
        sleepHours: input.sleepHours ?? null,
        energy: input.energy ?? null,
        mood: input.mood ?? null,
        notes: input.notes ?? null,
      },
    });
    return { message: 'Дневник обновлён', entryId: entry.id };
  },
});
