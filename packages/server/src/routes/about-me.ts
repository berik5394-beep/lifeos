import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { gatherAboutMe, forgetMemory, restoreMemory } from '../services/about-me.js';
import { readDiary } from '../services/robot-diary.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** «Что я о тебе помню» — экран робота (services/about-me.ts). */
export async function aboutMeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/memory/about-me', async (request) => gatherAboutMe(request.userId));

  /** Дневник робота (робот-друг №3): записи по дням; вчера/сегодня-вечер дописываются при открытии. */
  app.get('/robot/diary', async (request) => ({ entries: await readDiary(request.userId) }));

  /** «Это неправда» — робот забывает (обратимо). */
  app.post('/memory/:id/forget', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!ID_RE.test(id)) return reply.status(400).send({ message: 'Неверный id' });
    if (!(await forgetMemory(request.userId, id))) return reply.status(404).send({ message: 'Не нашёл такое воспоминание' });
    return { ok: true };
  });

  /** «Вернуть» — передумал. */
  app.post('/memory/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!ID_RE.test(id)) return reply.status(400).send({ message: 'Неверный id' });
    if (!(await restoreMemory(request.userId, id))) return reply.status(404).send({ message: 'Не нашёл такое воспоминание' });
    return { ok: true };
  });
}
