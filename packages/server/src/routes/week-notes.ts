import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { dateOnlyUTC } from '../lib/tz.js';

/**
 * Заметки недели (планер «Задач» и рефлексия в «Привычках»). Раньше жили
 * только на телефоне — мозг не видел, что человек сам записал про неделю.
 * Ключ — понедельник недели ('YYYY-MM-DD', календарная дата юзера).
 */
const FIELDS = ['notes', 'improve', 'gratitude', 'wins'] as const;
type Field = (typeof FIELDS)[number];
export const WEEK_NOTE_LABEL: Record<Field, string> = {
  notes: 'заметки',
  improve: 'что улучшить',
  gratitude: 'благодарность',
  wins: 'что получилось',
};

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const text = z.string().max(4000);
const putSchema = z.object({
  notes: text.optional(),
  improve: text.optional(),
  gratitude: text.optional(),
  wins: text.optional(),
});

const EMPTY = { notes: '', improve: '', gratitude: '', wins: '' };

function short(s: string, max = 160): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Что писать в память: только поля, которые были пустыми и стали непустыми
 * (первая запись рефлексии за неделю). Каждую правку не пишем — телефон
 * синхронизирует с задержкой, память засорялась бы черновиками; текущий
 * текст мозг читает прямо из таблицы.
 */
export function newlyFilled(prev: Partial<Record<Field, string>> | null, next: Partial<Record<Field, string>>): Field[] {
  return FIELDS.filter((f) => next[f] !== undefined && (next[f] as string).trim() !== '' && !(prev?.[f] ?? '').trim());
}

export async function weekNotesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/week-notes/:weekStart', async (request, reply) => {
    const { weekStart } = request.params as { weekStart: string };
    if (!WEEK_RE.test(weekStart)) return reply.status(400).send({ message: 'weekStart — в формате YYYY-MM-DD' });
    const row = await prisma.weekNote.findUnique({
      where: { userId_weekStart: { userId: request.userId, weekStart: dateOnlyUTC(weekStart) } },
      select: { notes: true, improve: true, gratitude: true, wins: true, updatedAt: true },
    });
    return { weekStart, ...(row ?? { ...EMPTY, updatedAt: null }) };
  });

  app.put('/week-notes/:weekStart', { preHandler: validate(putSchema) }, async (request, reply) => {
    const { weekStart } = request.params as { weekStart: string };
    if (!WEEK_RE.test(weekStart)) return reply.status(400).send({ message: 'weekStart — в формате YYYY-MM-DD' });
    const body = request.body as z.infer<typeof putSchema>;
    const key = { userId: request.userId, weekStart: dateOnlyUTC(weekStart) };
    const prev = await prisma.weekNote.findUnique({
      where: { userId_weekStart: key },
      select: { notes: true, improve: true, gratitude: true, wins: true },
    });
    const row = await prisma.weekNote.upsert({
      where: { userId_weekStart: key },
      create: { ...key, ...EMPTY, ...body },
      update: body,
      select: { notes: true, improve: true, gratitude: true, wins: true, updatedAt: true },
    });
    for (const f of newlyFilled(prev, body)) {
      captureActivity(request.userId, {
        type: 'week_note_written',
        content: `Неделя с ${weekStart}, ${WEEK_NOTE_LABEL[f]}: «${short(body[f] as string)}»`,
        importance: f === 'wins' || f === 'improve' ? 6 : 5,
      });
    }
    return { weekStart, ...row };
  });
}
