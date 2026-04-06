import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { processVoiceCommand } from '../ai/voice-pipeline.js';

const voiceSchema = z.object({
  text: z.string().min(1, 'Текст обязателен'),
});

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post('/voice/process', {
    preHandler: validate(voiceSchema),
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;

    try {
      const result = await processVoiceCommand(text);
      return reply.send(result);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки голосовой команды',
      });
    }
  });
}
