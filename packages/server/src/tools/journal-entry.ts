import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/** SSOT Step 5 — write-tool. 1:1 с legacy journal_entry (upsert на сегодня). */
export const journalEntryTool = defineTool({
  name: 'journal_entry',
  description:
    'Записать/обновить дневник самочувствия за сегодня: сон, ' +
    'энергия, настроение, заметки.',
  category: 'task',
  schema: z.object({
    sleepHours: z.number().min(0).max(24).optional(),
    energy: z.number().int().min(1).max(10).optional(),
    mood: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(2000).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['спал 7 часов, настроение 8', 'запиши в дневник: устал'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
