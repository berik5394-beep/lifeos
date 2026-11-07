import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { gatherAboutMe, forgetMemory, restoreMemory } from '../services/about-me.js';
import { readDiary } from '../services/robot-diary.js';
import { getPortrait } from '../services/portrait.js';
import { FRIEND_LEVELS, getFriendship, takeLevelUp } from '../services/friendship.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** «Что я о тебе помню» — экран робота (services/about-me.ts). */
export async function aboutMeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/memory/about-me', async (request) => gatherAboutMe(request.userId));

  /** «Каким я тебя вижу» — портрет по фактам со всего приложения (services/portrait.ts). */
  app.get('/memory/portrait', async (request) => getPortrait(request.userId));

  /** Дневник робота (робот-друг №3): записи по дням; вчера/сегодня-вечер дописываются при открытии. */
  app.get('/robot/diary', async (request) => ({ entries: await readDiary(request.userId) }));

  /** Уровень дружбы (робот-друг №4) + фраза о новом уровне, если робот о нём ещё не сказал. */
  app.get('/robot/friendship', async (request) => {
    const f = await getFriendship(request.userId);
    const levelUp = await takeLevelUp(request.userId, f).catch(() => null);
    return { ...f, levels: FRIEND_LEVELS, levelUp };
  });

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
